/**
 * "Mis validaciones" — the cashier's own list, hoy / ayer / 7 días.
 *
 * Three fixed ranges and no date picker, because this screen is read standing
 * up between customers: the questions a cashier has are "did that one go
 * through?", "what did I take yesterday?" and nothing else. Sandbox rows are
 * not filtered out here — a cashier testing against the sandbox account needs
 * to see what they just did — and the badge on the row says which is which.
 *
 * The days are Venezuelan days (`day-range.ts`), so "hoy" ends at midnight in
 * Caracas rather than four hours earlier.
 */
import type { Validation } from '../../adapters/d1/validation.repository.ts';
import type { Clock } from '../../shared/clock.ts';
import { logger } from '../../shared/logger.ts';
import { type NamedRange, venezuelaDayRange } from './day-range.ts';
import type { PageCursor } from './list-validations.ts';

type CashierValidationReader = {
  listByCashier(query: {
    readonly cashierId: string;
    readonly from: number;
    readonly to: number;
    readonly cursor?: PageCursor;
    readonly limit?: number;
  }): Promise<{
    readonly items: readonly Validation[];
    readonly nextCursor: PageCursor | null;
  }>;
};

export type ListMyValidationsDeps = {
  readonly validations: CashierValidationReader;
  readonly clock: Clock;
};

export type ListMyValidationsInput = {
  readonly companyId: string;
  readonly cashierId: string;
  readonly range?: NamedRange;
  readonly cursor?: PageCursor;
};

export type MyValidationList = {
  readonly items: readonly Validation[];
  readonly nextCursor: PageCursor | null;
  /** Echoed back so the screen can label the range it is showing. */
  readonly from: number;
  readonly to: number;
};

export type ListMyValidations = (input: ListMyValidationsInput) => Promise<MyValidationList>;

const PAGE_SIZE = 20;

export function makeListMyValidations({
  validations,
  clock,
}: ListMyValidationsDeps): ListMyValidations {
  return async (input) => {
    const { from, to } = venezuelaDayRange(input.range ?? 'today', clock.nowSeconds());

    const page = await validations.listByCashier({
      cashierId: input.cashierId,
      from,
      to,
      cursor: input.cursor,
      limit: PAGE_SIZE,
    });

    // A cashier belongs to exactly one company, so scoping by cashier already
    // scopes by merchant — but the boundary between merchants is not a thing to
    // infer. A row that disagrees is a data fault, and it is dropped and
    // reported rather than rendered.
    const items = page.items.filter((item) => item.companyId === input.companyId);
    if (items.length !== page.items.length) {
      logger.error('validation_company_mismatch', {
        companyId: input.companyId,
        cashierId: input.cashierId,
        dropped: page.items.length - items.length,
      });
    }

    return { items, nextCursor: page.nextCursor, from, to };
  };
}
