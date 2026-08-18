/**
 * "Hoy", "ayer" and "últimos 7 días" as epoch-second ranges.
 *
 * A merchant's day is the day their shop had, which ends at midnight in
 * Caracas and not at midnight UTC — four hours apart, and those four hours are
 * the busiest of a Venezuelan evening. Bucketing them into tomorrow would make
 * a closing till disagree with the panel every single night.
 *
 * Venezuela is UTC−4 with no daylight saving, so the offset is arithmetic
 * rather than a timezone database Workers may or may not carry. `Date` appears
 * twice and never reads a clock: through `venezuelaDate` in `shared/clock.ts`,
 * and as `Date.UTC`, which is arithmetic on a civil date. Everything else here
 * is integer seconds, which is what the columns are.
 */
import { VENEZUELA_UTC_OFFSET_MINUTES, venezuelaDate } from '../../shared/clock.ts';

const SECONDS_PER_DAY = 86_400;
const OFFSET_SECONDS = VENEZUELA_UTC_OFFSET_MINUTES * 60;

/** Both ends inclusive, matching the `created_at >= ? AND created_at <= ?` filter. */
export type DayRange = {
  readonly from: number;
  readonly to: number;
};

/** The instant the local day containing `epochSeconds` began. */
export function startOfVenezuelaDay(epochSeconds: number): number {
  const local = epochSeconds + OFFSET_SECONDS;
  return Math.floor(local / SECONDS_PER_DAY) * SECONDS_PER_DAY - OFFSET_SECONDS;
}

/** The last second of that day. Inclusive, so no payment falls between ranges. */
export function endOfVenezuelaDay(epochSeconds: number): number {
  return startOfVenezuelaDay(epochSeconds) + SECONDS_PER_DAY - 1;
}

/** The three tabs on the cashier's own list. */
export type NamedRange = 'today' | 'yesterday' | 'last_7_days';

export function venezuelaDayRange(range: NamedRange, now: number): DayRange {
  const startOfToday = startOfVenezuelaDay(now);

  if (range === 'yesterday') {
    return { from: startOfToday - SECONDS_PER_DAY, to: startOfToday - 1 };
  }
  // Seven days means today and the six before it — the way a shopkeeper counts
  // a week, not a 168-hour window ending now.
  if (range === 'last_7_days') {
    return { from: startOfToday - 6 * SECONDS_PER_DAY, to: startOfToday + SECONDS_PER_DAY - 1 };
  }
  return { from: startOfToday, to: startOfToday + SECONDS_PER_DAY - 1 };
}

/** The last `days` local days, today included. `days` of 1 is today. */
export function lastVenezuelaDays(days: number, now: number): DayRange {
  const startOfToday = startOfVenezuelaDay(now);
  const span = Math.max(1, Math.trunc(days)) - 1;
  return { from: startOfToday - span * SECONDS_PER_DAY, to: startOfToday + SECONDS_PER_DAY - 1 };
}

/**
 * `YYYY-MM-DD` in Caracas back to the instant that day began, and the last
 * second of it. The inverse of `venezuelaDate`, and the only way a *calendar*
 * question — "this month", "from the 3rd to the 12th" — becomes the epoch
 * bounds the columns compare against.
 *
 * `Date.UTC` is arithmetic on a civil date, not a reading of the clock, so it
 * stays on the pure side of the line the rest of this file holds: the offset is
 * applied here and the `Date` never sees a local timezone.
 */
export function startOfVenezuelaIsoDay(isoDay: string): number {
  const [year, month, day] = isoDay.split('-').map(Number);
  const utcMidnight = Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1) / 1000;
  return utcMidnight - OFFSET_SECONDS;
}

export function endOfVenezuelaIsoDay(isoDay: string): number {
  return startOfVenezuelaIsoDay(isoDay) + SECONDS_PER_DAY - 1;
}

/**
 * The relative spans the statistics screen offers. A custom range is the
 * seventh option and is deliberately not in this union: it carries its two days
 * on the URL rather than being derivable from the clock, so it is resolved in
 * `validation-stats.ts`, where the clamping policy lives.
 */
export type StatsRangePreset =
  | 'today'
  | 'yesterday'
  | 'last_7_days'
  | 'last_30_days'
  | 'this_month'
  | 'last_month';

/**
 * A preset as epoch bounds. Every one of them is a whole number of *local*
 * days, both ends inclusive, so a chart bucketed by day never shows a half one
 * at either edge.
 *
 * "Este mes" ends today rather than at the end of the month: a merchant asking
 * what they have taken this month means so far, and padding the axis with three
 * empty weeks of future would make the shape of the month unreadable.
 */
export function venezuelaStatsRange(preset: StatsRangePreset, now: number): DayRange {
  const today = venezuelaDate(now);
  const [year, month] = today.split('-').map(Number);

  switch (preset) {
    case 'today':
      return venezuelaDayRange('today', now);
    case 'yesterday':
      return venezuelaDayRange('yesterday', now);
    case 'last_7_days':
      return lastVenezuelaDays(7, now);
    case 'last_30_days':
      return lastVenezuelaDays(30, now);
    case 'this_month':
      return {
        from: startOfVenezuelaIsoDay(monthStart(year ?? 1970, month ?? 1)),
        to: endOfVenezuelaDay(now),
      };
    case 'last_month': {
      const previous =
        month === 1
          ? { year: (year ?? 1970) - 1, month: 12 }
          : { year: year ?? 1970, month: (month ?? 1) - 1 };
      const from = startOfVenezuelaIsoDay(monthStart(previous.year, previous.month));
      return { from, to: startOfVenezuelaIsoDay(monthStart(year ?? 1970, month ?? 1)) - 1 };
    }
  }
}

function monthStart(year: number, month: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}
