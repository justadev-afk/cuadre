/**
 * The global aggregates the login pitch shows. Two scalar reads, no rows mapped
 * back to domain types because there is no domain object here — only counts.
 *
 * "Pagos validados hoy" is a throughput figure, so it counts every confirmed
 * validation today, sandbox included — unlike the company panel's *cash* totals,
 * which exclude sandbox because those are money and this is activity.
 */
import type { LoginStatsReader } from '../../application/stats/login-stats.ts';

export class D1StatsRepository implements LoginStatsReader {
  constructor(private readonly db: D1Database) {}

  async read(since: number): Promise<{
    merchants: number;
    paymentsToday: number;
    avgLatencyMs: number | null;
  }> {
    const merchants = await this.db
      .prepare("SELECT COUNT(*) AS n FROM companies WHERE status = 'active'")
      .first<{ n: number }>();

    const payments = await this.db
      .prepare(
        `SELECT COUNT(*) AS n, AVG(latency_ms) AS avg_ms
           FROM validations
          WHERE created_at >= ?`,
      )
      .bind(since)
      .first<{ n: number; avg_ms: number | null }>();

    return {
      merchants: merchants?.n ?? 0,
      paymentsToday: payments?.n ?? 0,
      avgLatencyMs: payments?.avg_ms ?? null,
    };
  }
}
