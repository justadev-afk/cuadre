/**
 * Connecting a bank: one step, one screen, one write.
 *
 * It used to be two — verify the credentials, park them sealed in KV for ten
 * minutes, then come back and pick which of the merchant's accounts receives
 * the money. The account picker is gone (Banesco, 2026-08-11: a pago móvil is
 * found by phone, bank code and date, never by the receiving account), and with
 * nothing to choose between the two steps there was nothing left to wait for.
 * So the pause, the KV envelope and the handle that named it are all gone with
 * it: the merchant fills one form, the bank is asked once, and the row is
 * written in the same request.
 *
 * What survives unchanged is the rule: **nothing is persisted until the bank
 * accepts the credentials.** Proving them is `credential-groups.ts`, the same
 * walk `changeBankCredentials` runs, so "what makes a credential good" cannot
 * mean two different things depending on which modal the merchant opened.
 */
import type {
  BankAccount,
  BankAccountWriteFailure,
  NewBankAccount,
} from '../../adapters/d1/bank-account.repository.ts';
import type { Clock } from '../../shared/clock.ts';
import { seal } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
import type { IdGen } from '../../shared/id.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { BankEnvironment, BankGateway, BankId } from '../ports/bank-gateway.ts';
import type { AccountCredentials } from './account-credentials.ts';
import { type BankAccountView, toBankAccountView } from './bank-account-view.ts';
import type { BankOnboardingFailure } from './bank-failure.ts';
import { authenticateCredentialGroups, operateGroupOf } from './credential-groups.ts';

/** The merchant's own name for a connection is a label, not an identifier. */
const MAX_LABEL_LENGTH = 40;

type BankAccess = {
  /** Throws `bank_unsupported` for an id with no adapter — a deploy mistake. */
  get(bank: BankId): BankGateway;
};

/** The one write this file makes, and nothing else. */
type BankAccountWriter = {
  insert(input: NewBankAccount): Promise<Result<BankAccount, BankAccountWriteFailure>>;
};

export type ConnectBankAccountDeps = {
  readonly banks: BankAccess;
  readonly accounts: BankAccountWriter;
  readonly credsKey: string;
  readonly clock: Clock;
  readonly ids: IdGen;
};

export type ConnectBankAccountInput = {
  readonly companyId: string;
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  /**
   * Optional: what the merchant calls this connection. Two affiliations of one
   * bank are otherwise indistinguishable in the counter's dropdown, which is
   * the only reason the field exists.
   */
  readonly label?: string;
  /**
   * The full account numbers this connection receives transferencias in.
   *
   * Optional: a merchant who only takes pago móvil registers none, and the
   * counter offers them only that. They cannot be discovered — the bank reports
   * its accounts masked and refuses a masked one back — so they are typed once,
   * here.
   */
  readonly receivingAccounts?: readonly string[];
  /** The pairs the merchant filled, keyed by the gateway's credential-group key. */
  readonly credentials: AccountCredentials;
};

export type ConnectBankAccountFailure = BankOnboardingFailure | 'account_already_linked';

export type ConnectBankAccount = (
  input: ConnectBankAccountInput,
) => Promise<Result<BankAccountView, ConnectBankAccountFailure>>;

export function makeConnectBankAccount({
  banks,
  accounts,
  credsKey,
  clock,
  ids,
}: ConnectBankAccountDeps): ConnectBankAccount {
  return async (input) => {
    const gateway = banks.get(input.bank);
    const operateGroup = operateGroupOf(gateway);

    // A bank that does not run a sandbox cannot have sandbox credentials.
    if (!gateway.environments.includes(input.environment)) return err('environment_mismatch');

    const proven = await authenticateCredentialGroups({
      gateway,
      environment: input.environment,
      credentials: input.credentials,
      companyId: input.companyId,
      flow: 'connect',
    });
    if (!proven.ok) return err(proven.error.failure);

    // Every pair the bank accepted, as one map keyed by its own service key,
    // sealed as a single JSON value. What survives in the clear is the six-digit
    // tail of the operate client id, which is all the panel shows.
    const accepted: AccountCredentials = {};
    for (const { group, credentials: pair } of proven.value) accepted[group.key] = pair;

    const operateClientId = accepted[operateGroup.key]?.clientId ?? '';
    const now = clock.nowSeconds();

    const written = await accounts.insert({
      id: ids.uuid(),
      companyId: input.companyId,
      bank: input.bank,
      environment: input.environment,
      label: readLabel(input.label),
      receivingAccounts: readAccounts(input.receivingAccounts),
      clientIdLast6: lastSix(operateClientId),
      credentials: await seal(credsKey, accepted),
      // The bank tells us its credentials expire by rejecting them. No bank has
      // yet returned an expiry we could read, so nothing is invented here.
      credsExpireAt: null,
      // They authenticated a few milliseconds ago. Waiting for a first payment
      // to say so would show a merchant "sin verificar" about a bank that just
      // answered us.
      verifiedAt: now,
      createdAt: now,
    });

    if (!written.ok) {
      if (written.error === 'account_already_linked') return err('account_already_linked');
      throw new AppError('internal', `bank account insert failed: ${written.error}`);
    }

    logger.info('bank_account_connected', {
      companyId: input.companyId,
      bank: input.bank,
      environment: input.environment,
      pairs: Object.keys(accepted).length,
    });

    return ok(toBankAccountView(written.value));
  };
}

/**
 * The receiving accounts, kept as digits and de-duplicated.
 *
 * A Venezuelan account is twenty digits; the bound is loose on purpose, enough
 * to reject a slip of the keyboard without refusing a real number from a bank we
 * have not met yet. Anything that does not clear it is dropped rather than
 * refusing the whole connection: the merchant is connecting a bank, and a
 * mistyped account is fixed in Bancos afterwards.
 */
function readAccounts(accounts: readonly string[] | undefined): readonly string[] {
  const digits = (accounts ?? [])
    .map((account) => account.replace(/\D/g, ''))
    .filter((account) => account.length >= 10 && account.length <= 24);
  return [...new Set(digits)];
}

/** Trimmed, capped, and `null` rather than an empty string standing in for none. */
function readLabel(label: string | undefined): string | null {
  const trimmed = (label ?? '').trim().slice(0, MAX_LABEL_LENGTH);
  return trimmed === '' ? null : trimmed;
}

function lastSix(clientId: string): string | null {
  return clientId.length === 0 ? null : clientId.slice(-6);
}
