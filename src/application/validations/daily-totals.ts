/**
 * What the shop took, by day. The number on the dashboard card and the number
 * a merchant closes the till against.
 *
 * **Sandbox is excluded, always.** Not by a parameter, not by a default a
 * caller could pass through, and not by a toggle: a total is money, and a test
 * payment is not money. The repository's query carries `is_sandbox = 0` and
 * this use case offers no way to ask for anything else — the sandbox rows are
 * visible in the lists, where they are labelled, and nowhere near a sum.
 *
 * The day is `created_at` in Venezuelan local time — when the counter confirmed
 * the payment, which is the day the merchant means when they ask what they took
 * today. The bank's own `trn_at` is the reconciliation view and belongs to a
 * different report.
 */
import type { DailyTotal } from '../../adapters/d1/validation.repository.ts';
import type { Clock } from '../../shared/clock.ts';
import { lastVenezuelaDays } from './day-range.ts';

type DailyTotalsReader = {
  dailyTotals(query: {
    readonly companyId: string;
    readonly from: number;
    readonly to: number;
  }): Promise<readonly DailyTotal[]>;
};

export type DailyTotalsDeps = {
  readonly validations: DailyTotalsReader;
  readonly clock: Clock;
};

export type DailyTotalsInput = {
  readonly companyId: string;
  /** Local days back from today, today included. Default a week. */
  readonly days?: number;
};

export type DailyTotalsResult = {
  /** Most recent day first, and days with no payments are simply absent. */
  readonly days: readonly DailyTotal[];
  readonly from: number;
  readonly to: number;
  readonly totalCount: number;
  readonly totalAmountCents: number;
};

export type DailyTotals = (input: DailyTotalsInput) => Promise<DailyTotalsResult>;

const DEFAULT_DAYS = 7;

/**
 * A month at most. Beyond that the answer is a report someone exports, not a
 * card on a dashboard, and an unbounded span here is a table scan a merchant
 * can trigger by editing a query string.
 */
const MAX_DAYS = 31;

export function makeDailyTotals({ validations, clock }: DailyTotalsDeps): DailyTotals {
  return async (input) => {
    const days = Math.min(MAX_DAYS, Math.max(1, Math.trunc(input.days ?? DEFAULT_DAYS)));
    const { from, to } = lastVenezuelaDays(days, clock.nowSeconds());

    const totals = await validations.dailyTotals({ companyId: input.companyId, from, to });

    return {
      days: totals,
      from,
      to,
      totalCount: totals.reduce((sum, day) => sum + day.count, 0),
      totalAmountCents: totals.reduce((sum, day) => sum + day.amountCents, 0),
    };
  };
}
