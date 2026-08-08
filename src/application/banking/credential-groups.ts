/**
 * Proving a bank's credential groups — the one walk shared by connecting an
 * account and changing its credentials.
 *
 * Both flows ask the bank the exact same question ("are these pairs good?") and
 * were answering it twice, in two loops that had already started to drift. The
 * rule they encode decides money, so it lives here once:
 *
 *  - Exactly one group is `operate` — the pair the counter runs on. A bank
 *    without it is a deploy mistake, not a merchant's error, so it throws.
 *  - A group the merchant filled is proven by **authenticating** it. That is the
 *    strongest thing we can say about credentials without a payment in hand.
 *  - A `required` group left blank is a refusal on that group; an optional one
 *    left blank is skipped, and its absence becomes "type the number in".
 *  - A `discover` group additionally lists the accounts — that is its whole
 *    purpose, and an empty list means the affiliation is not finished.
 *
 * Nothing here names a bank or a service: the loop is over the gateway's own
 * declaration, so a bank with one pair and a bank with four flow through it
 * unchanged. Nothing here writes, seals or parks either — the caller decides
 * what to do with the pairs that passed.
 */
import { AppError } from '../../shared/errors.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type {
  BankAccountSummary,
  BankCredentialGroup,
  BankCredentials,
  BankEnvironment,
  BankGateway,
} from '../ports/bank-gateway.ts';
import type { AccountCredentials } from './account-credentials.ts';
import { type BankOnboardingFailure, toOnboardingFailure } from './bank-failure.ts';

/**
 * A refusal and the credential group it belongs to, so the form can put the
 * message under the exact pair that failed instead of on the whole screen.
 */
export type CredentialGroupFailure = {
  readonly groupKey: string;
  readonly failure: BankOnboardingFailure;
};

/** One group the bank accepted, with the pair it accepted. In declaration order. */
export type AuthenticatedGroup = {
  readonly group: BankCredentialGroup;
  readonly credentials: BankCredentials;
};

export type AuthenticatedCredentials = {
  readonly groups: readonly AuthenticatedGroup[];
  /** From the discover pair. Empty when none was given — type the number in. */
  readonly accounts: readonly BankAccountSummary[];
};

/**
 * The group the counter runs on. Every bank must declare exactly one; a gateway
 * that declares none cannot validate a payment at all, which is our mistake and
 * not something a merchant can fix by retyping.
 */
export function operateGroupOf(gateway: BankGateway): BankCredentialGroup {
  const group = gateway.credentialGroups.find((candidate) => candidate.usage === 'operate');
  if (group === undefined) {
    throw new AppError('internal', `bank ${gateway.id} declares no operate credentials`);
  }
  return group;
}

/**
 * Walks the gateway's declared groups, authenticating each pair the merchant
 * filled. Returns the groups that passed, in declaration order, plus whatever a
 * discover pair listed. Stops on the first refusal, naming the group.
 */
export async function authenticateCredentialGroups({
  gateway,
  environment,
  credentials,
  companyId,
  flow,
}: {
  readonly gateway: BankGateway;
  readonly environment: BankEnvironment;
  /** The pairs the merchant filled, keyed by the gateway's credential-group key. */
  readonly credentials: AccountCredentials;
  readonly companyId: string;
  /** Which flow is asking — the rejection log stays tellable apart in Workers Logs. */
  readonly flow: 'connect' | 'change';
}): Promise<Result<AuthenticatedCredentials, CredentialGroupFailure>> {
  const groups: AuthenticatedGroup[] = [];
  let accounts: readonly BankAccountSummary[] = [];

  for (const group of gateway.credentialGroups) {
    const pair = credentials[group.key];
    const filled = pair !== undefined && pair.clientId !== '' && pair.clientSecret !== '';
    if (!filled) {
      if (group.required) return err({ groupKey: group.key, failure: 'invalid_input' });
      continue;
    }

    const session = await gateway.authenticate(environment, pair);
    if (!session.ok) {
      logger.warn('bank_credentials_rejected', {
        flow,
        companyId,
        bank: gateway.id,
        environment,
        group: group.key,
        failure: session.error,
      });
      return err({ groupKey: group.key, failure: toOnboardingFailure(session.error) });
    }
    groups.push({ group, credentials: pair });

    // The discover pair earns its place by listing accounts.
    if (group.usage === 'discover') {
      const listed = await gateway.listAccounts(session.value);
      if (!listed.ok) {
        return err({ groupKey: group.key, failure: toOnboardingFailure(listed.error) });
      }
      if (listed.value.length === 0) {
        return err({ groupKey: group.key, failure: 'no_accounts' });
      }
      accounts = listed.value;
    }
  }

  return ok({ groups, accounts });
}
