/**
 * The company panel's list of confirmed payments.
 *
 * There is no status filter, and that is not an omission: a row in
 * `validations` *is* a charged payment, so the only things worth narrowing by
 * are which environment (Todos / Producción / Sandbox), which days, **whose
 * work** (a cashier, by id), and — when a customer phones about one payment — a
 * reference or a phone number.
 *
 * Paging is keyset, twenty at a time, because a merchant scrolling their month
 * on a phone at the till must not pay for an OFFSET that re-walks every row
 * before the page they asked for.
 *
 * The search is the interesting part. The repository has no LIKE and is not
 * ours to grow one, so a searched page is a bounded scan: rows are pulled in
 * the same keyset order and filtered here until twenty match or the scan
 * budget runs out. The cursor that comes back points at the last row
 * *examined*, not the last row matched, so continuing never re-reads and never
 * skips. That is affordable because a company's month is a few thousand rows;
 * if it stops being affordable, the honest fix is an index and a WHERE clause,
 * not a bigger budget here.
 */
import type { Validation } from '../../adapters/d1/validation.repository.ts';
import { matchesValidation } from './validation-search.ts';

/**
 * The keyset position, declared structurally so this file agrees with the
 * repository's ORDER BY without importing its codec: turning a cursor into an
 * opaque string is a wire concern and belongs to the layer that speaks HTTP.
 */
export type PageCursor = {
  readonly createdAt: number;
  readonly id: string;
};

type ValidationReader = {
  listByCompany(query: {
    readonly companyId: string;
    readonly isSandbox?: boolean;
    readonly cashierId?: string;
    readonly from: number;
    readonly to: number;
    readonly cursor?: PageCursor;
    readonly limit?: number;
  }): Promise<{
    readonly items: readonly Validation[];
    readonly nextCursor: PageCursor | null;
  }>;
};

export type ListValidationsDeps = {
  readonly validations: ValidationReader;
};

/** The three segments of the panel's toggle, in the order they are shown. */
export type EnvironmentFilter = 'all' | 'production' | 'sandbox';

export type ListValidationsInput = {
  readonly companyId: string;
  /** Epoch seconds, both inclusive. The panel always has a range on screen. */
  readonly from: number;
  readonly to: number;
  readonly environment?: EnvironmentFilter;
  /**
   * One person's work. By **id**, not by name: two cashiers called María are one
   * shop's ordinary Tuesday, and the free-text search below — which does match
   * on the name — cannot tell them apart.
   */
  readonly cashierId?: string;
  /** A reference, a payer's phone, a cashier's name, or an amount in bolívares. */
  readonly search?: string;
  readonly cursor?: PageCursor;
};

export type ValidationList = {
  readonly items: readonly Validation[];
  /** `null` when this was the last page. */
  readonly nextCursor: PageCursor | null;
};

export type ListValidations = (input: ListValidationsInput) => Promise<ValidationList>;

/** One page, as the design shows it. */
const PAGE_SIZE = 20;

/** The repository's own ceiling: one round trip per hundred rows scanned. */
const SCAN_BATCH = 100;

/**
 * Rows examined per searched request. Five round trips is the most a panel
 * should spend before handing back what it has and a cursor to continue with —
 * a search that runs out of budget still returns a page and a "cargar más".
 */
const SCAN_LIMIT = 500;

export function makeListValidations({ validations }: ListValidationsDeps): ListValidations {
  return async (input) => {
    // The filter every path below shares, searched or not: narrowing by cashier
    // is a WHERE the database applies, so it costs the scan nothing and it is
    // exact where a name match would not be.
    const filter = {
      companyId: input.companyId,
      isSandbox: toSandboxFlag(input.environment ?? 'all'),
      cashierId: input.cashierId,
      from: input.from,
      to: input.to,
    };

    const term = (input.search ?? '').trim();
    if (term === '') {
      // The common path stays one query and one round trip.
      const page = await validations.listByCompany({
        ...filter,
        cursor: input.cursor,
        limit: PAGE_SIZE,
      });
      return { items: page.items, nextCursor: page.nextCursor };
    }

    const items: Validation[] = [];
    let cursor = input.cursor;
    let examined = 0;

    while (items.length < PAGE_SIZE && examined < SCAN_LIMIT) {
      const page = await validations.listByCompany({ ...filter, cursor, limit: SCAN_BATCH });
      if (page.items.length === 0) return { items, nextCursor: null };

      for (const item of page.items) {
        examined++;
        // Any examined row is a valid resume point: the repository's keyset
        // predicate means "strictly after this row", so stopping mid-page
        // loses nothing and repeats nothing.
        cursor = { createdAt: item.createdAt, id: item.id };
        if (matchesValidation(item, term)) items.push(item);
        if (items.length >= PAGE_SIZE || examined >= SCAN_LIMIT) break;
      }

      const stopped = items.length >= PAGE_SIZE || examined >= SCAN_LIMIT;
      if (!stopped && page.nextCursor === null) return { items, nextCursor: null };
    }

    return { items, nextCursor: cursor ?? null };
  };
}

/** Omitted means both, which is what "Todos" means. */
function toSandboxFlag(environment: EnvironmentFilter): boolean | undefined {
  if (environment === 'production') return false;
  if (environment === 'sandbox') return true;
  return undefined;
}
