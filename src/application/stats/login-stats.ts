/**
 * The three figures the login pitch shows — merchants, today's payments, and
 * the average bank response — computed for real, not mocked.
 *
 * `/login` is unauthenticated and hit by everyone, so it must not scan D1 on
 * every visit. The snapshot is therefore read from KV; on a miss it is computed
 * once from D1 and parked back with a short TTL. The figures are global totals
 * — no company's data is in them, only counts — which is why an anonymous page
 * may show them.
 */
import type { Clock } from '../../shared/clock.ts';
import { startOfVenezuelaDay } from '../validations/day-range.ts';

export type LoginStats = {
  /** Active merchants. */
  readonly merchants: number;
  /** Confirmed, non-sandbox payments since the start of today (Caracas time). */
  readonly paymentsToday: number;
  /** Average bank-response latency of those payments, in seconds, one decimal. */
  readonly avgResponseSeconds: number;
};

/**
 * The raw aggregates as the database counts them. `avgLatencyMs` is `null` when
 * there is nothing to average — a fresh day, not a zero response.
 */
export interface LoginStatsReader {
  read(sinceEpochSeconds: number): Promise<{
    readonly merchants: number;
    readonly paymentsToday: number;
    readonly avgLatencyMs: number | null;
  }>;
}

/** A short-lived KV snapshot, so the page is a single KV read. */
export interface LoginStatsCache {
  get(): Promise<LoginStats | null>;
  put(stats: LoginStats, ttlSeconds: number): Promise<void>;
}

export type GetLoginStatsDeps = {
  readonly reader: LoginStatsReader;
  readonly cache: LoginStatsCache;
  readonly clock: Clock;
  /** How long a computed snapshot serves before it is recomputed. */
  readonly cacheTtlSeconds: number;
};

export type GetLoginStats = () => Promise<LoginStats>;

export function makeGetLoginStats({
  reader,
  cache,
  clock,
  cacheTtlSeconds,
}: GetLoginStatsDeps): GetLoginStats {
  return async () => {
    const cached = await cache.get();
    if (cached !== null) return cached;

    const since = startOfVenezuelaDay(clock.nowSeconds());
    const raw = await reader.read(since);
    const stats: LoginStats = {
      merchants: raw.merchants,
      paymentsToday: raw.paymentsToday,
      // One decimal of seconds, the way the pitch reads ('2,4 s').
      avgResponseSeconds: raw.avgLatencyMs === null ? 0 : Math.round(raw.avgLatencyMs / 100) / 10,
    };
    await cache.put(stats, cacheTtlSeconds);
    return stats;
  };
}
