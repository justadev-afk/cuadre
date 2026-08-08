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
import { matchesValidation } from './validation-search.ts';

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
  /** A reference, a control code, the payer's phone, or an amount in bolívares. */
  readonly search?: string;
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

/** The reader's own ceiling: one round trip per hundred rows scanned. */
const SCAN_BATCH = 100;

/**
 * Rows examined per searched request — the same budget the company panel
 * spends. A cashier's own day is a handful of rows, so a search almost always
 * finishes in the first batch; the ceiling only bounds a pathological "7 días"
 * with a term that matches nothing.
 */
const SCAN_LIMIT = 500;

export function makeListMyValidations({
  validations,
  clock,
}: ListMyValidationsDeps): ListMyValidations {
  return async (input) => {
    const { from, to } = venezuelaDayRange(input.range ?? 'today', clock.nowSeconds());
    const term = (input.search ?? '').trim();

    // A cashier belongs to exactly one company, so scoping by cashier already
    // scopes by merchant — but the boundary between merchants is not a thing to
    // infer. A row that disagrees is a data fault, dropped and reported rather
    // than rendered. `dropped` accumulates across the scan and is logged once.
    let dropped = 0;
    const mine = (item: Validation): boolean => {
      if (item.companyId === input.companyId) return true;
      dropped++;
      return false;
    };
    const report = (): void => {
      if (dropped > 0) {
        logger.error('validation_company_mismatch', {
          companyId: input.companyId,
          cashierId: input.cashierId,
          dropped,
        });
      }
    };

    if (term === '') {
      // The common path stays one query and one round trip.
      const page = await validations.listByCashier({
        cashierId: input.cashierId,
        from,
        to,
        cursor: input.cursor,
        limit: PAGE_SIZE,
      });
      const items = page.items.filter(mine);
      report();
      return { items, nextCursor: page.nextCursor, from, to };
    }

    // A searched page is a bounded scan: the reader has no LIKE, so rows come in
    // keyset order and are filtered here until a page fills or the budget runs
    // out. The cursor that comes back points at the last row *examined*, so
    // continuing never re-reads and never skips.
    const items: Validation[] = [];
    let cursor = input.cursor;
    let examined = 0;

    while (items.length < PAGE_SIZE && examined < SCAN_LIMIT) {
      const page = await validations.listByCashier({
        cashierId: input.cashierId,
        from,
        to,
        cursor,
        limit: SCAN_BATCH,
      });
      if (page.items.length === 0) {
        report();
        return { items, nextCursor: null, from, to };
      }

      for (const item of page.items) {
        examined++;
        cursor = { createdAt: item.createdAt, id: item.id };
        if (mine(item) && matchesValidation(item, term)) items.push(item);
        if (items.length >= PAGE_SIZE || examined >= SCAN_LIMIT) break;
      }

      const stopped = items.length >= PAGE_SIZE || examined >= SCAN_LIMIT;
      if (!stopped && page.nextCursor === null) {
        report();
        return { items, nextCursor: null, from, to };
      }
    }

    report();
    return { items, nextCursor: cursor ?? null, from, to };
  };
}
