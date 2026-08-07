/**
 * A bank's failure, in the vocabulary the onboarding screens speak.
 *
 * `BankFailure` is what the port promises and it is nearly the right list
 * already — this exists for the two places it is not. `environment_mismatch`
 * has no equivalent on the port because no bank reports it: it is our own
 * judgement about credentials that authenticated somewhere the merchant did not
 * declare. And `rate_limited` folds into `unavailable`, because
 * `src/shared/errors.ts` reserves the `rate_limited` code for *our* limiter and
 * its copy talks about the user's own attempts — telling a merchant who typed
 * their client secret once that they have tried too many times would be a lie.
 *
 * Every onboarding use case answers with this union, so the screen that renders
 * the failure has one list to branch on rather than one per step.
 */
import type { BankFailure } from '../ports/bank-gateway.ts';

export type BankOnboardingFailure =
  | 'rejected_credentials'
  | 'environment_mismatch'
  | 'no_accounts'
  | 'maintenance'
  | 'unavailable'
  | 'timeout'
  | 'invalid_input';

export function toOnboardingFailure(failure: BankFailure): BankOnboardingFailure {
  return failure === 'rate_limited' ? 'unavailable' : failure;
}
