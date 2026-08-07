/**
 * "Hoy", "ayer" and "últimos 7 días" as epoch-second ranges.
 *
 * A merchant's day is the day their shop had, which ends at midnight in
 * Caracas and not at midnight UTC — four hours apart, and those four hours are
 * the busiest of a Venezuelan evening. Bucketing them into tomorrow would make
 * a closing till disagree with the panel every single night.
 *
 * Venezuela is UTC−4 with no daylight saving, so the offset is arithmetic
 * rather than a timezone database Workers may or may not carry. `Date` is used
 * only through `venezuelaDate` in `shared/clock.ts`; everything here is integer
 * seconds, which is what the columns are.
 */
import { VENEZUELA_UTC_OFFSET_MINUTES } from '../../shared/clock.ts';

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
