/**
 * Replacing the OAuth credentials on a connected account, verified against the
 * bank before a byte is persisted — the counterpart to onboarding for a client
 * secret that was rotated in the bank's own portal.
 *
 * The bank and the environment are the account's identity: the per-company
 * unique key is (bank, environment, last4), so neither changes here — to switch
 * bank or environment a merchant connects a *new* account. Only the credential
 * pairs are rewritten. Each now lives on its own row with its own key version
 * (migration 0003), so the account number's envelope is left untouched — there
 * is no shared version to keep true anymore.
 *
 * Nothing about the old secret is read back to the caller; the new pairs are
 * proven the same way onboarding proves them — by `credential-groups.ts`, the
 * one walk both flows share, so "what makes a credential good" cannot mean two
 * different things depending on which screen the merchant opened.
 */
import type {
  BankAccount,
  BankAccountWriteFailure,
  NewStoredCredential,
} from '../../adapters/d1/bank-account.repository.ts';
import type { Clock } from '../../shared/clock.ts';
import { seal } from '../../shared/crypto.ts';
import type { IdGen } from '../../shared/id.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { BankGateway, BankId } from '../ports/bank-gateway.ts';
import type { AccountCredentials } from './account-credentials.ts';
import { type BankAccountView, toBankAccountView } from './bank-account-view.ts';
import type { BankOnboardingFailure } from './bank-failure.ts';
import { authenticateCredentialGroups, operateGroupOf } from './credential-groups.ts';

type BankAccess = {
  get(bank: BankId): BankGateway;
};

type BankAccountStore = {
  findById(id: string): Promise<BankAccount | null>;
  replaceCredentials(
    id: string,
    credentials: readonly NewStoredCredential[],
    clientIdLast6: string | null,
    verifiedAt: number,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>>;
};

export type ChangeBankCredentialsDeps = {
  readonly banks: BankAccess;
  readonly accounts: BankAccountStore;
  readonly credsKey: string;
  readonly clock: Clock;
  readonly ids: IdGen;
};

export type ChangeBankCredentialsInput = {
  readonly companyId: string;
  readonly accountId: string;
  /** The new pairs, keyed by the bank's credential-group key. */
  readonly credentials: AccountCredentials;
};

export type ChangeBankCredentialsFailure = BankOnboardingFailure | 'not_found';

export type ChangeBankCredentials = (
  input: ChangeBankCredentialsInput,
) => Promise<Result<BankAccountView, ChangeBankCredentialsFailure>>;

export function makeChangeBankCredentials({
  banks,
  accounts,
  credsKey,
  clock,
  ids,
}: ChangeBankCredentialsDeps): ChangeBankCredentials {
  return async (input) => {
    const account = await accounts.findById(input.accountId);
    // Same reasoning as `remove`/`reverify`: not yours reads as not there, so an
    // id can never enumerate another merchant's accounts.
    if (account === null || account.companyId !== input.companyId) return err('not_found');
    if (account.status === 'removed') return err('not_found');

    const gateway = banks.get(account.bank);
    const operateGroup = operateGroupOf(gateway);

    // Nothing is written unless the bank accepts the pairs. The refusal loses its
    // group here — the modal shows one message for the whole form — but the walk
    // that produced it is the onboarding one.
    const proven = await authenticateCredentialGroups({
      gateway,
      environment: account.environment,
      credentials: input.credentials,
      companyId: input.companyId,
      flow: 'change',
    });
    if (!proven.ok) return err(proven.error.failure);

    // Each accepted pair becomes a fresh row, sealed on its own; the whole set
    // replaces the old.
    const rows: NewStoredCredential[] = [];
    for (const { group, credentials } of proven.value.groups) {
      rows.push({
        id: ids.uuid(),
        credKey: group.key,
        usage: group.usage,
        clientIdLast6: credentials.clientId.slice(-6),
        credentials: await seal(credsKey, credentials),
      });
    }

    const operate = input.credentials[operateGroup.key];
    const clientIdLast6 = operate === undefined ? null : operate.clientId.slice(-6);

    const updated = await accounts.replaceCredentials(
      account.id,
      rows,
      clientIdLast6,
      clock.nowSeconds(),
    );
    if (!updated.ok) return err('not_found');

    logger.info('bank_credentials_changed', {
      companyId: input.companyId,
      bank: account.bank,
      environment: account.environment,
      pairs: rows.length,
    });

    return ok(toBankAccountView(updated.value));
  };
}
