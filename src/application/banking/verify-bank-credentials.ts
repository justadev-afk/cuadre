/**
 * Step two of connecting a bank: prove the credentials work and show what they
 * can see. **Nothing is persisted to D1 here.**
 *
 * A bank declares its credentials in groups — one pair per service (Banesco: a
 * required Confirmación pair the counter runs on, and an optional Consulta pair
 * that lists the accounts). Proving them is `credential-groups.ts`, the same
 * walk `changeBankCredentials` runs: the two flows ask the bank the identical
 * question and must not answer it twice. What is left here is what only
 * onboarding does — parking what passed.
 *
 * The pairs that passed are sealed together as a keyed map and parked in KV for
 * ten minutes (`pending-verification.ts`), with the account numbers: the picker
 * gets the bank's masking and an opaque handle, never a number it could change.
 */
import { seal } from '../../shared/crypto.ts';
import type { IdGen } from '../../shared/id.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type {
  BankAccountSummary,
  BankEnvironment,
  BankGateway,
  BankId,
} from '../ports/bank-gateway.ts';
import type { AccountCredentials } from './account-credentials.ts';
import {
  authenticateCredentialGroups,
  type CredentialGroupFailure,
  operateGroupOf,
} from './credential-groups.ts';
import {
  accountHandle,
  VERIFICATION_TTL_SECONDS,
  type VerificationPayload,
  type VerificationStore,
} from './pending-verification.ts';

/** Narrow, structural, declared where it is consumed. `BankRegistry` satisfies it. */
type BankAccess = {
  /** Throws `bank_unsupported` for an id with no adapter — a deploy mistake. */
  get(bank: BankId): BankGateway;
};

export type VerifyBankCredentialsDeps = {
  readonly banks: BankAccess;
  readonly verifications: VerificationStore;
  /**
   * The AES-GCM master key. It arrives as a dependency and is never read from
   * `env` in here: a use case that reaches for a binding is a use case that
   * cannot be constructed in a test without one.
   */
  readonly credsKey: string;
  readonly ids: IdGen;
};

export type VerifyBankCredentialsInput = {
  readonly companyId: string;
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  /** The pairs the merchant filled, keyed by the gateway's credential-group key. */
  readonly credentials: AccountCredentials;
};

/** One row of the account picker. No full account number, by construction. */
export type SelectableAccount = {
  /** Opaque handle into the sealed verification. Send it back to connect. */
  readonly accountId: string;
  /** The bank's own masking, or ours where it does not mask. Safe to render. */
  readonly masked: string;
  readonly type: string | null;
  readonly balanceCents: number | null;
  readonly holderId: string | null;
};

export type VerifiedCredentials = {
  /** Names the sealed credentials in KV for the next ten minutes. */
  readonly verifyId: string;
  /** From a discover pair. Empty when none was given — type the number in. */
  readonly accounts: readonly SelectableAccount[];
};

/** A refusal and the credential group it belongs to. */
export type VerifyBankCredentialsFailure = CredentialGroupFailure;

export type VerifyBankCredentials = (
  input: VerifyBankCredentialsInput,
) => Promise<Result<VerifiedCredentials, VerifyBankCredentialsFailure>>;

export function makeVerifyBankCredentials({
  banks,
  verifications,
  credsKey,
  ids,
}: VerifyBankCredentialsDeps): VerifyBankCredentials {
  return async (input) => {
    const gateway = banks.get(input.bank);
    const operateGroup = operateGroupOf(gateway);

    // A bank that does not run a sandbox cannot have sandbox credentials.
    if (!gateway.environments.includes(input.environment)) {
      return err({ groupKey: operateGroup.key, failure: 'environment_mismatch' });
    }

    const proven = await authenticateCredentialGroups({
      gateway,
      environment: input.environment,
      credentials: input.credentials,
      companyId: input.companyId,
      flow: 'connect',
    });
    if (!proven.ok) return err(proven.error);

    const { accounts } = proven.value;
    const provided: AccountCredentials = {};
    for (const { group, credentials } of proven.value.groups) provided[group.key] = credentials;

    const verifyId = ids.uuid();
    const payload: VerificationPayload = {
      companyId: input.companyId,
      bank: input.bank,
      environment: input.environment,
      credentials: provided,
      operateKey: operateGroup.key,
      accounts,
    };
    await verifications.put(verifyId, await seal(credsKey, payload), VERIFICATION_TTL_SECONDS);

    logger.info('bank_credentials_verified', {
      companyId: input.companyId,
      bank: input.bank,
      environment: input.environment,
      pairs: Object.keys(provided).length,
      accounts: accounts.length,
    });

    return ok({ verifyId, accounts: accounts.map(toSelectable) });
  };
}

function toSelectable(account: BankAccountSummary, index: number): SelectableAccount {
  return {
    accountId: accountHandle(index),
    masked: account.masked,
    type: account.type,
    balanceCents: account.balanceCents,
    holderId: account.holderId,
  };
}
