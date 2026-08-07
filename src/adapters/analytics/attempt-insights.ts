/**
 * Reading `cuadre_attempts` back through the Analytics Engine SQL API.
 *
 * The `METRICS` binding only *writes*. Querying the dataset is a plain HTTPS
 * endpoint — `POST /accounts/{id}/analytics_engine/sql` with the SQL as the raw
 * body and a Cloudflare API token in the `Authorization` header — so this
 * adapter is an HTTP client, not a binding. It speaks the positional column
 * names the writer laid down (`blob5` = outcome, `blob6` = the bank code,
 * `double1` = latency, `index1` = company) and nothing here may reorder them:
 * the schema contract lives in `adapters/metrics/attempt.metrics.ts`.
 *
 * The SQL API takes no bind parameters — the query is a string — so the only
 * values that ever reach it are an integer day count and limit (clamped) and a
 * company slug (single-quote-escaped). No user free text is interpolated.
 */
import { z } from 'zod';

import type {
  AttemptInsightsSource,
  CompanyFailures,
  InsightsWindow,
  OutcomeBucket,
} from '../../application/observability/attempt-insights.ts';
import { AppError } from '../../shared/errors.ts';

/** The Analytics Engine dataset name, as declared in `wrangler.toml`. */
const DATASET = 'cuadre_attempts';

/** Guard-rails on the two integers that reach the query string. */
const MAX_WINDOW_DAYS = 400;
const MAX_TOP_LIMIT = 50;

/**
 * The SQL API's reply. `data` is an array of row objects keyed by the `AS`
 * aliases below; numbers can arrive as JSON numbers or as strings depending on
 * the aggregate, so every numeric field is coerced rather than trusted.
 */
const SqlReply = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
});

export type AttemptInsightsConfig = {
  readonly accountId: string;
  readonly apiToken: string;
  /** Injected so a test never touches the network; defaults to the global. */
  readonly fetchFn?: typeof fetch;
  readonly userAgent?: string;
};

export class CloudflareAttemptInsights implements AttemptInsightsSource {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly config: AttemptInsightsConfig) {
    this.fetchFn = config.fetchFn ?? fetch;
  }

  async outcomeBuckets(window: InsightsWindow): Promise<OutcomeBucket[]> {
    const scope = window.companyId === undefined ? '' : ` AND index1 = ${quote(window.companyId)}`;
    const rows = await this.run(
      `SELECT blob5 AS outcome, blob6 AS bank_status,
              count() AS n, sum(double1) AS latency_sum
         FROM ${DATASET}
        WHERE ${sinceClause(window.days)}${scope}
        GROUP BY blob5, blob6`,
    );
    return rows.map((row) => ({
      outcome: str(row.outcome),
      bankStatus: str(row.bank_status),
      count: num(row.n),
      latencySumMs: num(row.latency_sum),
    }));
  }

  async topFailingCompanies(days: number, limit: number): Promise<CompanyFailures[]> {
    const capped = clamp(limit, 1, MAX_TOP_LIMIT);
    const rows = await this.run(
      `SELECT index1 AS company, count() AS n
         FROM ${DATASET}
        WHERE ${sinceClause(days)} AND blob5 = 'bank_failure'
        GROUP BY index1
        ORDER BY n DESC
        LIMIT ${capped}`,
    );
    return rows
      .map((row) => ({ companyId: str(row.company), failures: num(row.n) }))
      .filter((row) => row.companyId !== '');
  }

  private async run(sql: string): Promise<Record<string, unknown>[]> {
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.config.accountId}/analytics_engine/sql`;
    const response = await this.fetchFn(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiToken}`,
        'content-type': 'text/plain',
        ...(this.config.userAgent ? { 'user-agent': this.config.userAgent } : {}),
      },
      body: sql,
    });

    if (!response.ok) {
      // The body can echo the query, never a secret — but the status is enough
      // to tell a bad token (403) from a malformed query (400) in the logs.
      throw new AppError('internal', `analytics sql api returned ${response.status}`);
    }

    const parsed = SqlReply.safeParse(await response.json());
    if (!parsed.success) throw new AppError('internal', 'analytics sql api reply unreadable');
    return parsed.data.data;
  }
}

/** `timestamp > NOW() - INTERVAL 'N' DAY`, with N a clamped integer. */
function sinceClause(days: number): string {
  return `timestamp > NOW() - INTERVAL '${clamp(days, 1, MAX_WINDOW_DAYS)}' DAY`;
}

/** A SQL string literal: single quotes doubled, the only escaping the API needs. */
function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Math.trunc(value)));
}

/** Coerce a cell to a finite number; a missing or unparseable aggregate is 0. */
function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Coerce a cell to a string; a null blob (no bank code) reads as ''. */
function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}
