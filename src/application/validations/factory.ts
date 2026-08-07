/**
 * The validation use cases, built once from one set of dependencies.
 *
 * Wiring only, exactly as `banking/factory.ts` is: the container builds the
 * adapters from `env` and this file fits them to the narrow ports each use case
 * declared for itself. `validatePayment` is the one that decides money, and it
 * is built here with the same `Clock` and `IdGen` the rest of the request uses
 * so that a test can freeze both.
 */
import type { BankAccountRepository } from '../../adapters/d1/bank-account.repository.ts';
import type { ValidationRepository } from '../../adapters/d1/validation.repository.ts';
import type { AttemptMetrics } from '../../adapters/metrics/attempt.metrics.ts';
import type { Clock } from '../../shared/clock.ts';
import type { IdGen } from '../../shared/id.ts';
import type { BankGateway, BankId } from '../ports/bank-gateway.ts';
import { type DailyTotals, makeDailyTotals } from './daily-totals.ts';
import { type ListMyValidations, makeListMyValidations } from './list-my-validations.ts';
import { type ListValidations, makeListValidations } from './list-validations.ts';
import { makeValidatePayment, type ValidatePayment } from './validate-payment.ts';

export type ValidationsDeps = {
  readonly validations: ValidationRepository;
  readonly accounts: BankAccountRepository;
  /** `BankRegistry`: the account's `bank` column picks the gateway. */
  readonly banks: {
    get(bank: BankId): BankGateway;
  };
  readonly metrics: AttemptMetrics;
  readonly clock: Clock;
  readonly ids: IdGen;
  /** The AES-GCM master key. Read from `env` once, in the container. */
  readonly credsKey: string;
};

export type ValidationUseCases = {
  readonly validatePayment: ValidatePayment;
  readonly listValidations: ListValidations;
  readonly listMyValidations: ListMyValidations;
  readonly dailyTotals: DailyTotals;
};

export function makeValidationUseCases(deps: ValidationsDeps): ValidationUseCases {
  return {
    validatePayment: makeValidatePayment(deps),
    listValidations: makeListValidations(deps),
    listMyValidations: makeListMyValidations(deps),
    dailyTotals: makeDailyTotals(deps),
  };
}
