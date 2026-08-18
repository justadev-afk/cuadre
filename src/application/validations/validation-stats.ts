/**
 * The statistics screen's whole answer, over one span the merchant chose.
 *
 * The panel a merchant lands on answers "what did I take *today*". This answers
 * the questions that come after it — which day of the week is worth opening
 * early for, which counter moves the money, which bank the customers pay from,
 * whether the pago móvil is drowning the transferencia. All of them are the
 * same six GROUP BYs over one range, so they are one batch and one use case
 * rather than a screen assembling five queries.
 *
 * Two rules from the rest of the system hold here without exception:
 *
 *  - **Sandbox is not money.** The repository's SQL carries `is_sandbox = 0` and
 *    there is no parameter on this input that could ever turn it off.
 *  - **A day is a Venezuelan day.** Every bucket, every boundary and the "hoy"
 *    at the end of a relative range is Caracas local, resolved against the clock
 *    at the moment the question is asked (`day-range.ts`).
 *
 * What this file adds on top of the rows is the shape a chart needs: the days
 * with no payments are absent from a GROUP BY and present on an axis, so the
 * series is filled in here; the hours likewise, all twenty-four of them, because
 * "we sell nothing before ten" is exactly the thing the chart is for and an
 * empty hour that is simply missing would silently close the gap.
 */
import type {
  CashierBucket,
  DailyTotal,
  StatsBucket,
  ValidationStats as ValidationStatsRows,
} from '../../adapters/d1/validation.repository.ts';
import { findBank } from '../../domain/sudeban.ts';
import { type Clock, venezuelaDate } from '../../shared/clock.ts';
import type { PaymentKind } from '../ports/bank-gateway.ts';
import {
  endOfVenezuelaDay,
  endOfVenezuelaIsoDay,
  type StatsRangePreset,
  startOfVenezuelaDay,
  startOfVenezuelaIsoDay,
  venezuelaStatsRange,
} from './day-range.ts';

type StatsReader = {
  stats(query: {
    readonly companyId: string;
    readonly from: number;
    readonly to: number;
  }): Promise<ValidationStatsRows>;
};

export type ValidationStatsDeps = {
  readonly validations: StatsReader;
  readonly clock: Clock;
};

/** A preset, or the two days a merchant picked on the calendar. */
export type ValidationStatsInput = {
  readonly companyId: string;
  readonly preset?: StatsRangePreset;
  /** `YYYY-MM-DD`, both inclusive. Together they win over the preset. */
  readonly from?: string;
  readonly to?: string;
};

export type StatsRange = {
  /** `'custom'` when the two days came off the calendar rather than a preset. */
  readonly preset: StatsRangePreset | 'custom';
  readonly from: number;
  readonly to: number;
  /** `YYYY-MM-DD`, so a screen can put them back on the calendar. */
  readonly fromDay: string;
  readonly toDay: string;
  /** Whole local days covered, both ends included. */
  readonly days: number;
  /** True when the merchant asked for more than `MAX_DAYS` and got the tail. */
  readonly clamped: boolean;
};

export type DayPoint = {
  /** `YYYY-MM-DD` in Caracas. Every day in the range, gaps filled with zeros. */
  readonly date: string;
  readonly count: number;
  readonly amountCents: number;
};

export type HourPoint = {
  /** 0–23, Caracas local. All twenty-four are present. */
  readonly hour: number;
  readonly count: number;
  readonly amountCents: number;
};

export type NamedTotal = {
  readonly key: string;
  readonly label: string | null;
  readonly count: number;
  readonly amountCents: number;
};

export type KindTotal = {
  readonly kind: PaymentKind;
  readonly count: number;
  readonly amountCents: number;
};

export type ValidationStatsView = {
  readonly range: StatsRange;
  readonly totalCount: number;
  readonly totalAmountCents: number;
  /** Rounded to the cent. Zero when there were no payments, never NaN. */
  readonly averageTicketCents: number;
  readonly maxAmountCents: number;
  /** Distinct payer phones — a transferencia carries none and counts for nobody. */
  readonly payers: number;
  /** Days in the range that saw at least one payment. */
  readonly activeDays: number;
  /** Over the *whole* range, empty days included: what a day is worth here. */
  readonly dailyAverageAmountCents: number;
  readonly series: readonly DayPoint[];
  /** The strongest day in the range, or `null` when nothing was validated. */
  readonly bestDay: DayPoint | null;
  readonly byHour: readonly HourPoint[];
  /** Most money first. `label` is the person's name, `null` if the row lost it. */
  readonly byCashier: readonly NamedTotal[];
  /** Most money first, keyed by the payer's Sudeban code. */
  readonly bySourceBank: readonly NamedTotal[];
  /** Both kinds, always, so a zero reads as a zero rather than as a gap. */
  readonly byKind: readonly KindTotal[];
};

export type ValidationStatsQuery = (input: ValidationStatsInput) => Promise<ValidationStatsView>;

const SECONDS_PER_DAY = 86_400;

/**
 * A quarter, at most. Past that the daily axis is thinner than the gap between
 * its columns and the honest answer is an export, not a dashboard — the same
 * call `daily-totals.ts` makes at a month for the card on the panel.
 */
export const MAX_STATS_DAYS = 92;

const DEFAULT_PRESET: StatsRangePreset = 'last_7_days';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function makeValidationStats({
  validations,
  clock,
}: ValidationStatsDeps): ValidationStatsQuery {
  return async (input) => {
    const range = resolveRange(input, clock.nowSeconds());
    const rows = await validations.stats({
      companyId: input.companyId,
      from: range.from,
      to: range.to,
    });

    const series = fillDays(rows.byDay, range);
    const activeDays = rows.byDay.filter((day) => day.count > 0).length;

    return {
      range,
      totalCount: rows.summary.count,
      totalAmountCents: rows.summary.amountCents,
      averageTicketCents:
        rows.summary.count === 0 ? 0 : Math.round(rows.summary.amountCents / rows.summary.count),
      maxAmountCents: rows.summary.maxAmountCents,
      payers: rows.summary.payers,
      activeDays,
      dailyAverageAmountCents:
        range.days === 0 ? 0 : Math.round(rows.summary.amountCents / range.days),
      series,
      bestDay: strongest(series),
      byHour: fillHours(rows.byHour),
      byCashier: byMoney(rows.byCashier.map(fromCashier)),
      bySourceBank: byMoney(rows.bySourceBank.map(fromSourceBank)),
      byKind: bothKinds(rows.byKind),
    };
  };
}

/**
 * Which span was actually read.
 *
 * A custom range is two days a person typed or clicked, so all four ways of
 * getting it wrong are handled rather than refused: reversed ends are swapped,
 * a future end is pulled back to today, and a span longer than `MAX_STATS_DAYS`
 * keeps its **end** and moves its start forward — a merchant who asks for too
 * much wants the recent part of it, not the oldest quarter. `clamped` says so,
 * so the screen can too.
 */
function resolveRange(input: ValidationStatsInput, now: number): StatsRange {
  const custom = readCustom(input.from, input.to, now);
  if (custom !== null) return custom;

  const preset = input.preset ?? DEFAULT_PRESET;
  const { from, to } = venezuelaStatsRange(preset, now);
  return {
    preset,
    from,
    to,
    fromDay: venezuelaDate(from),
    toDay: venezuelaDate(to),
    days: dayCount(from, to),
    clamped: false,
  };
}

function readCustom(
  from: string | undefined,
  to: string | undefined,
  now: number,
): StatsRange | null {
  if (from === undefined || to === undefined) return null;
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return null;

  const today = venezuelaDate(now);
  const [first, last] = from <= to ? [from, to] : [to, from];
  const end = last > today ? today : last;
  if (first > end) return null;

  let start = startOfVenezuelaIsoDay(first);
  const finish = endOfVenezuelaIsoDay(end);
  const asked = dayCount(start, finish);
  const clamped = asked > MAX_STATS_DAYS;
  if (clamped) start = finish + 1 - MAX_STATS_DAYS * SECONDS_PER_DAY;

  return {
    preset: 'custom',
    from: start,
    to: finish,
    fromDay: venezuelaDate(start),
    toDay: venezuelaDate(finish),
    days: dayCount(start, finish),
    clamped,
  };
}

function dayCount(from: number, to: number): number {
  return Math.max(
    1,
    Math.round((endOfVenezuelaDay(to) + 1 - startOfVenezuelaDay(from)) / SECONDS_PER_DAY),
  );
}

/**
 * Every day of the range, oldest first, with the days nobody paid on drawn as
 * zeros. A GROUP BY omits them; an axis cannot, or a quiet Sunday closes the
 * gap between Saturday and Monday and the week reads as busier than it was.
 */
function fillDays(rows: readonly DailyTotal[], range: StatsRange): readonly DayPoint[] {
  const found = new Map(rows.map((row) => [row.date, row]));
  const points: DayPoint[] = [];

  for (let day = startOfVenezuelaDay(range.from); day <= range.to; day += SECONDS_PER_DAY) {
    const date = venezuelaDate(day);
    const row = found.get(date);
    points.push({
      date,
      count: row?.count ?? 0,
      amountCents: row?.amountCents ?? 0,
    });
  }
  return points;
}

/** All twenty-four, in order. An hour with no payments is a zero, not a gap. */
function fillHours(rows: readonly StatsBucket[]): readonly HourPoint[] {
  const found = new Map(rows.map((row) => [Number(row.key), row]));
  return Array.from({ length: 24 }, (_, hour) => {
    const row = found.get(hour);
    return { hour, count: row?.count ?? 0, amountCents: row?.amountCents ?? 0 };
  });
}

function strongest(series: readonly DayPoint[]): DayPoint | null {
  let best: DayPoint | null = null;
  for (const point of series) {
    if (point.amountCents > 0 && (best === null || point.amountCents > best.amountCents)) {
      best = point;
    }
  }
  return best;
}

function fromCashier(row: CashierBucket): NamedTotal {
  return { key: row.key, label: row.name, count: row.count, amountCents: row.amountCents };
}

/**
 * A payer's bank as a name, and as its four digits when our table of codes has
 * not heard of it. The row records what the bank was asked with, and that stays
 * true even after Sudeban adds one.
 */
function fromSourceBank(row: StatsBucket): NamedTotal {
  return {
    key: row.key,
    label: findBank(row.key)?.name ?? null,
    count: row.count,
    amountCents: row.amountCents,
  };
}

function byMoney(rows: readonly NamedTotal[]): readonly NamedTotal[] {
  return [...rows].sort((a, b) => b.amountCents - a.amountCents || b.count - a.count);
}

/**
 * Both kinds in a fixed order, whatever the GROUP BY returned. A shop that only
 * takes pago móvil should read "transferencia: 0", not be left wondering whether
 * the row is missing because there were none or because nobody counted them.
 */
function bothKinds(rows: readonly StatsBucket[]): readonly KindTotal[] {
  const found = new Map(rows.map((row) => [row.key, row]));
  const kinds: readonly PaymentKind[] = ['pago_movil', 'transferencia'];
  return kinds.map((kind) => {
    const row = found.get(kind);
    return { kind, count: row?.count ?? 0, amountCents: row?.amountCents ?? 0 };
  });
}
