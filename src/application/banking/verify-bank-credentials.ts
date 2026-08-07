/**
 * Step two of connecting a bank: prove the credentials work and show what they
 * can see. **Nothing is persisted to D1 here.**
 *
 * A bank declares its credentials in groups — one pair per service (Banesco: a
 * required Confirmación pair the counter runs on, and an optional Consulta pair
 * that lists the accounts). This use case iterates whatever groups the gateway
 * declares and validates each pair the merchant filled **one at a time**,
 * reporting which group a refusal belongs to. It names no service and no bank:
 * a bank with one credential pair and a bank with four flow through the same
 * loop, because the loop is over the gateway's own declaration.
 *
 *  - A group's pair is proven by authenticating it. That is the strongest thing
 *    we can say about credentials without a payment in hand.
 *  - A `discover` group additionally lists the accounts — that is its whole
 *    purpose, and an empty list means the affiliation is not finished.
 *  - A `required` group left blank is a refusal on that group; an optional one
 *    left blank is simply skipped, and its absence becomes "type the number in".
 *
 * The pairs that passed are sealed together as a keyed map and parked in KV for
 * ten minutes (`pending-verification.ts`), with the account numbers: the picker
 * gets the bank's masking and an opaque handle, never a number it could change.
 */
import { seal } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
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
import { type BankOnboardingFailure, toOnboardingFailure } from './bank-failure.ts';
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

/**
 * A refusal and the credential group it belongs to, so the form can put the
 * message under the exact pair that failed instead of on the whole screen.
 */
export type VerifyBankCredentialsFailure = {
  readonly groupKey: string;
  readonly failure: BankOnboardingFailure;
};

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
    const operateGroup = gateway.credentialGroups.find((group) => group.usage === 'operate');
    // Every bank must have exactly one operate pair — the counter needs one to
    // run on. A bank without it is a deploy mistake, not a merchant's error.
    if (operateGroup === undefined) {
      throw new AppError('internal', `bank ${input.bank} declares no operate credentials`);
    }

    // A bank that does not run a sandbox cannot have sandbox credentials.
    if (!gateway.environments.includes(input.environment)) {
      return err({ groupKey: operateGroup.key, failure: 'environment_mismatch' });
    }

    const provided: AccountCredentials = {};
    let accounts: readonly BankAccountSummary[] = [];

    for (const group of gateway.credentialGroups) {
      const creds = input.credentials[group.key];
      const filled = creds !== undefined && creds.clientId !== '' && creds.clientSecret !== '';
      if (!filled) {
        if (group.required) return err({ groupKey: group.key, failure: 'invalid_input' });
        continue;
      }

      const session = await gateway.authenticate(input.environment, creds);
      if (!session.ok) {
        logger.warn('bank_verify_rejected', {
          companyId: input.companyId,
          bank: input.bank,
          environment: input.environment,
          group: group.key,
          failure: session.error,
        });
        return err({ groupKey: group.key, failure: toOnboardingFailure(session.error) });
      }
      provided[group.key] = creds;

      // The discover pair earns its place by listing accounts.
      if (group.usage === 'discover') {
        const listed = await gateway.listAccounts(session.value);
        if (!listed.ok)
          return err({ groupKey: group.key, failure: toOnboardingFailure(listed.error) });
        if (listed.value.length === 0) return err({ groupKey: group.key, failure: 'no_accounts' });
        accounts = listed.value;
      }
    }

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
