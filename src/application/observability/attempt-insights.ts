/**
 * What the attempt telemetry says, shaped for the admin panel.
 *
 * `validations` stores confirmed payments only; every *failed* attempt — a
 * cashier's *todavía no aparece*, a bank rejecting the merchant's credentials,
 * an account with no permission on the service it was pointed at — leaves its
 * single trace in the `cuadre_attempts` Analytics Engine dataset and nowhere
 * else (see `adapters/metrics/attempt.metrics.ts`). This use case reads that
 * dataset back so an admin can see, per company and across the platform, what
 * is actually going wrong at the counter.
 *
 * The one distinction that matters here is the product's: **`not_found` is not
 * an error.** It is the honest "the bank does not report this payment yet", and
 * it dominates the volume, so the panel keeps it apart from the failures the
 * admin is actually hunting — credentials rejected, service unavailable, the
 * bank in maintenance. Those all arrive as `outcome = 'bank_failure'` carrying
 * a normalised code; the breakdown below is over exactly that set.
 *
 * The source is a port, not the SQL API directly, and it may be `null`: the API
 * token is a maintainer-provisioned secret with no local emulation, so a build
 * without it answers `unconfigured` rather than throwing. A query that is
 * configured but fails answers `error`. Neither ever takes down the page.
 */
import { logger } from '../../shared/logger.ts';

/** The window a question is asked over, and the company it is scoped to. */
export type InsightsWindow = {
  readonly days: number;
  /** Absent for the platform-wide view; a company slug for one merchant. */
  readonly companyId?: string;
};

/** One `(outcome, bankStatus)` bucket, exactly as the dataset groups it. */
export type OutcomeBucket = {
  readonly outcome: string;
  /** The normalised bank code for a failure; '' for outcomes that carry none. */
  readonly bankStatus: string;
  readonly count: number;
  /** Summed latency over the bucket, so an average survives re-grouping in code. */
  readonly latencySumMs: number;
};

/** A company and how many bank failures it saw in the window. */
export type CompanyFailures = {
  readonly companyId: string;
  readonly failures: number;
};

/**
 * Reading the dataset. Declared here, where the use case consumes it; the
 * Cloudflare SQL API is one adapter behind it and a fake is the other.
 */
export interface AttemptInsightsSource {
  /** Attempts grouped by outcome and bank code within the window. */
  outcomeBuckets(window: InsightsWindow): Promise<OutcomeBucket[]>;
  /** The companies with the most bank failures. Platform-wide only. */
  topFailingCompanies(days: number, limit: number): Promise<CompanyFailures[]>;
}

/** One normalised bank-failure code and how often it fired. */
export type FailureCode = {
  readonly code: string;
  readonly count: number;
};

/** The shaped numbers the panel renders. */
export type AttemptInsights = {
  readonly windowDays: number;
  readonly totalAttempts: number;
  readonly confirmed: number;
  readonly notFound: number;
  readonly alreadyCharged: number;
  readonly bankFailures: number;
  /** `bankFailures` split by normalised code, most common first. */
  readonly failuresByCode: readonly FailureCode[];
  /** Mean latency across every attempt in the window, ms. 0 when there are none. */
  readonly avgLatencyMs: number;
  /** Platform-wide view only; empty when scoped to one company. */
  readonly topFailingCompanies: readonly CompanyFailures[];
};

/**
 * `unconfigured` — no SQL API token in this environment; `error` — the query
 * was attempted and failed; `ok` — the numbers. The panel renders all three,
 * so a missing secret reads as a setup note, never as a broken screen.
 */
export type AttemptInsightsView =
  | { readonly status: 'unconfigured' }
  | { readonly status: 'error' }
  | ({ readonly status: 'ok' } & AttemptInsights);

/** How many companies the platform-wide failure ranking shows. */
const TOP_COMPANIES_LIMIT = 8;

export type GetAttemptInsights = (window: InsightsWindow) => Promise<AttemptInsightsView>;

export function makeGetAttemptInsights(deps: {
  readonly source: AttemptInsightsSource | null;
}): GetAttemptInsights {
  return async (window) => {
    if (deps.source === null) return { status: 'unconfigured' };

    try {
      const global = window.companyId === undefined;
      const [buckets, topCompanies] = await Promise.all([
        deps.source.outcomeBuckets(window),
        global
          ? deps.source.topFailingCompanies(window.days, TOP_COMPANIES_LIMIT)
          : Promise.resolve([]),
      ]);
      return { status: 'ok', ...shape(buckets, topCompanies, window.days) };
    } catch (error) {
      logger.warn('attempt_insights_query_failed', {
        companyId: window.companyId ?? '(all)',
        err: error instanceof Error ? error.message : String(error),
      });
      return { status: 'error' };
    }
  };
}

/** Fold the raw buckets into the panel's numbers. Pure, so it is table-tested. */
function shape(
  buckets: readonly OutcomeBucket[],
  topCompanies: readonly CompanyFailures[],
  windowDays: number,
): AttemptInsights {
  const totalOf = (outcome: string): number =>
    buckets.filter((b) => b.outcome === outcome).reduce((sum, b) => sum + b.count, 0);

  const totalAttempts = buckets.reduce((sum, b) => sum + b.count, 0);
  const latencySum = buckets.reduce((sum, b) => sum + b.latencySumMs, 0);

  const failuresByCode = buckets
    .filter((b) => b.outcome === 'bank_failure')
    .map((b) => ({ code: b.bankStatus === '' ? 'desconocido' : b.bankStatus, count: b.count }))
    .sort((a, b) => b.count - a.count);

  return {
    windowDays,
    totalAttempts,
    confirmed: totalOf('confirmed'),
    notFound: totalOf('not_found'),
    alreadyCharged: totalOf('already_charged'),
    bankFailures: totalOf('bank_failure'),
    failuresByCode,
    avgLatencyMs: totalAttempts === 0 ? 0 : Math.round(latencySum / totalAttempts),
    topFailingCompanies: topCompanies,
  };
}
