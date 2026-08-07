/**
 * Asking a connected account the same question onboarding asked: do these
 * credentials still read this account?
 *
 * It is the button behind the `needs_reverify` badge, and it is also what a
 * merchant reaches for when the counter starts answering "el banco no pudo
 * responder" — the difference between a bank having a bad afternoon and a
 * client secret that was rotated in the bank's portal last week is a question
 * only the bank can settle, and this asks it away from a queue of customers.
 *
 * Nothing is re-typed and nothing is re-sealed: the stored credentials are
 * unsealed, used, and left exactly as they were. A *new* secret is a new
 * connection, because the row's `client_id_last6` and its seal are written
 * together.
 */
import type {
  BankAccount,
  BankAccountStatus,
  BankAccountWriteFailure,
} from '../../adapters/d1/bank-account.repository.ts';
import { type Clock, venezuelaDate } from '../../shared/clock.ts';
import { unseal } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { BankCredentials, BankFailure, BankGateway, BankId } from '../ports/bank-gateway.ts';
import { type OpenedCredential, operateCredential } from './account-credentials.ts';
import { type BankAccountView, toBankAccountView } from './bank-account-view.ts';
import { type BankOnboardingFailure, toOnboardingFailure } from './bank-failure.ts';

type BankAccess = {
  get(bank: BankId): BankGateway;
};

type BankAccountStore = {
  findById(id: string): Promise<BankAccount | null>;
  markVerified(
    id: string,
    at: number,
    credsExpireAt: number | null,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>>;
  setStatus(
    id: string,
    status: BankAccountStatus,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>>;
};

export type ReverifyBankAccountDeps = {
  readonly banks: BankAccess;
  readonly accounts: BankAccountStore;
  readonly credsKey: string;
  readonly clock: Clock;
};

export type ReverifyBankAccountInput = {
  readonly companyId: string;
  readonly accountId: string;
};

export type ReverifyBankAccountFailure = BankOnboardingFailure | 'not_found';

export type ReverifyBankAccount = (
  input: ReverifyBankAccountInput,
) => Promise<Result<BankAccountView, ReverifyBankAccountFailure>>;

export function makeReverifyBankAccount({
  banks,
  accounts,
  credsKey,
  clock,
}: ReverifyBankAccountDeps): ReverifyBankAccount {
  return async (input) => {
    const account = await accounts.findById(input.accountId);
    // Same reasoning as `remove-bank-account`: not yours reads as not there.
    if (account === null || account.companyId !== input.companyId) return err('not_found');
    if (account.status === 'removed') return err('not_found');

    // Unlike a pending verification, these envelopes are the only copy: nobody
    // can paste them again. A row we cannot open is an operational fault, and it
    // must page someone rather than read as "the bank said no".
    const opened = await openCredentials(credsKey, account).catch(() => {
      throw new AppError('internal', `bank credentials unreadable for account ${account.id}`);
    });
    const accountNumber = await unseal<string>(credsKey, account.accountNumber).catch(() => {
      throw new AppError('internal', `account number unreadable for account ${account.id}`);
    });

    // Reverify asks the same question the counter does, so it uses the same
    // pair: the operate one — or the lone pair, for a single-credential bank.
    // Other pairs, if present, only ever listed accounts at onboarding.
    const gateway = banks.get(account.bank);
    const operate = operateCredential(opened);
    if (operate === null) {
      throw new AppError('internal', `bank account ${account.id} has no operate credentials`);
    }
    const session = await gateway.authenticate(account.environment, operate);
    if (!session.ok) return failed(accounts, account, session.error);

    const today = venezuelaDate(clock.nowSeconds());
    const smoke = await gateway.listMovements(session.value, {
      accountId: accountNumber,
      from: today,
      to: today,
    });
    if (!smoke.ok) return failed(accounts, account, smoke.error);

    const verified = await accounts.markVerified(account.id, clock.nowSeconds(), null);
    if (!verified.ok) return err('not_found');

    logger.info('bank_account_reverified', {
      companyId: input.companyId,
      bank: account.bank,
      environment: account.environment,
    });

    return ok(toBankAccountView(verified.value));
  };
}

/**
 * A rejection moves the account to `needs_reverify`; anything else leaves it
 * alone.
 *
 * The distinction is who said no. `rejected_credentials` is the bank giving a
 * settled answer about the secret we hold, and the panel should show it before
 * a cashier discovers it. Maintenance, a timeout or an unreachable host say
 * nothing about the credentials at all, and flagging the account on one of
 * those would put a red badge on every merchant's panel the next time a bank
 * has a bad ten minutes.
 */
async function failed(
  accounts: BankAccountStore,
  account: BankAccount,
  failure: BankFailure,
): Promise<Result<BankAccountView, ReverifyBankAccountFailure>> {
  if (failure === 'rejected_credentials' && account.status === 'active') {
    await accounts.setStatus(account.id, 'needs_reverify');
  }

  logger.warn('bank_account_reverify_failed', {
    companyId: account.companyId,
    bank: account.bank,
    environment: account.environment,
    failure,
  });

  return err(toOnboardingFailure(failure));
}

/** Every stored pair, unsealed. A single failure rejects the whole read. */
function openCredentials(credsKey: string, account: BankAccount): Promise<OpenedCredential[]> {
  return Promise.all(
    account.credentials.map(async (stored) => ({
      credKey: stored.credKey,
      usage: stored.usage,
      credentials: await unseal<BankCredentials>(credsKey, stored.credentials),
    })),
  );
}
