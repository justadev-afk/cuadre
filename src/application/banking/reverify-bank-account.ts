/**
 * Asking a connected bank the same question onboarding asked: do these
 * credentials still work?
 *
 * It is the button behind the `needs_reverify` badge, and it is also what a
 * merchant reaches for when the counter starts answering "el banco no pudo
 * responder" — the difference between a bank having a bad afternoon and a
 * client secret that was rotated in the bank's portal last week is a question
 * only the bank can settle, and this asks it away from a queue of customers.
 *
 * Authenticating is now the whole of it. It used to also read a day of
 * movements as a smoke test, and that read needed a receiving account number
 * which no longer exists (migration 0007) — nor would it prove anything extra:
 * the credentials either open a session or they do not, and whether *this*
 * payment is findable is the question the counter asks, loudly, where it
 * belongs.
 *
 * Nothing is re-typed and nothing is re-sealed: the stored credentials are
 * unsealed, used, and left exactly as they were. A *new* secret goes through
 * "cambiar credenciales", which writes the seal and the client id tail together.
 */
import type {
  BankAccount,
  BankAccountStatus,
  BankAccountWriteFailure,
} from '../../adapters/d1/bank-account.repository.ts';
import type { Clock } from '../../shared/clock.ts';
import { unseal } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { BankFailure, BankGateway, BankId } from '../ports/bank-gateway.ts';
import { type AccountCredentials, operateCredential } from './account-credentials.ts';
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

    // This envelope is the only copy: nobody can paste the secret again. A row
    // we cannot open is an operational fault, and it must page someone rather
    // than read as "the bank said no".
    const opened = await openCredentials(credsKey, account).catch(() => {
      throw new AppError('internal', `bank credentials unreadable for account ${account.id}`);
    });

    // Reverify asks the same question the counter does, so it uses the same
    // pair: the operate one — or the lone pair, for a single-credential bank.
    const gateway = banks.get(account.bank);
    const operate = operateCredential(opened, gateway.operateKey);
    if (operate === null) {
      throw new AppError('internal', `bank account ${account.id} has no operate credentials`);
    }
    const session = await gateway.authenticate(account.environment, operate);
    if (!session.ok) return failed(accounts, account, session.error);

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

/** The credential map, unsealed. */
function openCredentials(credsKey: string, account: BankAccount): Promise<AccountCredentials> {
  return unseal<AccountCredentials>(credsKey, account.credentials);
}
