/**
 * Time as a port.
 *
 * `src/domain` is pure and may not call `Date.now()`, so every rule that
 * depends on the current time takes it as a parameter. This supplies it, and
 * a test replaces it with a fixed number.
 */

/**
 * Venezuela is UTC−4 with no daylight saving. The bank's `trnDate` is a local
 * date and our "today" has to mean the same day the counter means, so the
 * offset is applied explicitly rather than trusting a runtime timezone
 * database that Workers may or may not carry.
 */
export const VENEZUELA_UTC_OFFSET_MINUTES = -240;

export type Clock = {
  /** Epoch seconds. The unit every timestamp column uses. */
  nowSeconds(): number;
  /** Epoch milliseconds, for latency measurement. */
  nowMillis(): number;
};

export const systemClock: Clock = {
  nowSeconds: () => Math.floor(Date.now() / 1000),
  nowMillis: () => Date.now(),
};

/** A clock frozen at an instant. Tests only — exported so they need no fake of their own. */
export function fixedClock(epochSeconds: number): Clock {
  return {
    nowSeconds: () => epochSeconds,
    nowMillis: () => epochSeconds * 1000,
  };
}

/** `YYYY-MM-DD` for the given instant, in Venezuela local time. */
export function venezuelaDate(epochSeconds: number): string {
  const local = new Date((epochSeconds + VENEZUELA_UTC_OFFSET_MINUTES * 60) * 1000);
  return local.toISOString().slice(0, 10);
}

/**
 * The two functions that bridge the domain and the database. The domain works
 * in epoch seconds (compared and ordered constantly); the tables store ISO-8601
 * UTC (`2026-08-07T18:42:12Z`) so a human or an IDE can read a row. The repos
 * convert on the way in and out — this is the only seam where the two meet, and
 * the round trip is lossless at one-second granularity.
 *
 * Deterministic: `new Date(<number>)` is a pure conversion, not `Date.now()`.
 */
export function epochToIso(epochSeconds: number): string {
  return `${new Date(epochSeconds * 1000).toISOString().slice(0, 19)}Z`;
}

/** ISO-8601 (its `Z` says UTC) back to the epoch seconds the domain compares. */
export function isoToEpoch(iso: string): number {
  return Math.floor(Date.parse(iso) / 1000);
}
