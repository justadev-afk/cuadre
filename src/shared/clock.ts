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
