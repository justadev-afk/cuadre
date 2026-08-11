/**
 * Proving a bank's credential groups — the one walk shared by connecting a bank
 * and changing its credentials.
 *
 * Both flows ask the bank the exact same question ("are these pairs good?") and
 * were answering it twice, in two loops that had already started to drift. The
 * rule they encode decides money, so it lives here once:
 *
 *  - The gateway names the group the counter runs on (`operateKey`). A bank
 *    whose declaration does not contain it is a deploy mistake, not a
 *    merchant's error, so it throws.
 *  - A group the merchant filled is proven by **authenticating** it. That is the
 *    strongest thing we can say about credentials without a payment in hand.
 *  - A `required` group left blank is a refusal on that group; an optional one
 *    left blank is skipped.
 *
 * Nothing here names a bank or a service: the loop is over the gateway's own
 * declaration, so a bank with one pair and a bank with four flow through it
 * unchanged. Nothing here writes or seals either — the caller decides what to do
 * with the pairs that passed.
 */
import { AppError } from '../../shared/errors.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type {
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

/**
 * The group the counter runs on. Every bank declares one by key; a gateway
 * pointing at a group it does not have cannot validate a payment at all, which
 * is our mistake and not something a merchant can fix by retyping.
 */
export function operateGroupOf(gateway: BankGateway): BankCredentialGroup {
  const group = gateway.credentialGroups.find((candidate) => candidate.key === gateway.operateKey);
  if (group === undefined) {
    throw new AppError('internal', `bank ${gateway.id} declares no operate credentials`);
  }
  return group;
}

/**
 * Walks the gateway's declared groups, authenticating each pair the merchant
 * filled. Returns the groups that passed, in declaration order. Stops on the
 * first refusal, naming the group.
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
}): Promise<Result<readonly AuthenticatedGroup[], CredentialGroupFailure>> {
  const groups: AuthenticatedGroup[] = [];

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
  }

  return ok(groups);
}
