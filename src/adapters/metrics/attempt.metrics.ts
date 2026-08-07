/**
 * One Analytics Engine data point per validation attempt — found or not.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * `validations` stores confirmed payments ONLY. An attempt that found nothing
 * writes no row anywhere: it is not an accounting fact, and keeping it out of
 * that table is what lets the company panel drop a status filter and lets
 * `ux_validations_payment` mean exactly what it says. The consequence is that
 * **this is the only trace a failed attempt leaves at all.** The rate at which
 * cashiers see *todavía no aparece* — the single number that says whether the
 * product feels reliable at a counter, and the one that shows a bank's
 * settlement lag before a merchant phones to report it — is measurable here or
 * nowhere. Delete this call and that number stops existing retroactively.
 *
 * WHAT MUST NEVER GO IN A BLOB: a payment reference, a payer's phone, an
 * account number, a client id or secret, a session id, a cashier's name. This
 * dataset is queried by anyone with SQL API access and is not covered by the
 * masking in `logger.ts`. The input type below is closed for that reason —
 * there is no free-form field to be tempted by.
 */
import type {
  BankEnvironment,
  BankId,
  FoundPayment,
} from '../../application/ports/bank-gateway.ts';
import { logger } from '../../shared/logger.ts';

/**
 * What the counter saw. `not_found` is the honest answer, not a failure — and
 * it is the reason this dataset exists.
 */
export type AttemptOutcome = 'confirmed' | 'not_found' | 'already_charged' | 'bank_failure';

/** `'none'` when nothing was found, so no route can claim to have found it. */
export type SearchStrategy = FoundPayment['strategy'] | 'none';

export type ValidationAttempt = {
  readonly companyId: string;
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  readonly searchStrategy: SearchStrategy;
  readonly outcome: AttemptOutcome;
  /** The bank's own status or failure code, already normalised by its adapter. */
  readonly bankStatus: string | null;
  readonly latencyMs: number;
  /** Zero when nothing was found — a stored validation always has a positive amount. */
  readonly amountCents: number;
};

export interface AttemptMetrics {
  record(attempt: ValidationAttempt): void;
}

/**
 * Analytics Engine columns are positional: `blob1`..`blob6` and
 * `double1`..`double2`. Every dashboard and every saved query names them by
 * position, so inserting a field in the middle of either list silently
 * reinterprets all of the history behind it. Append, never insert.
 */
const BLOB_MAX_LENGTH = 64;
const INDEX_MAX_LENGTH = 32;

export class AnalyticsEngineAttemptMetrics implements AttemptMetrics {
  constructor(private readonly dataset: AnalyticsEngineDataset) {}

  record(attempt: ValidationAttempt): void {
    try {
      this.dataset.writeDataPoint({
        // One index, and it is the company: every question worth asking of
        // this dataset starts with "for which merchant?".
        indexes: [clip(attempt.companyId, INDEX_MAX_LENGTH)],
        blobs: [
          clip(attempt.companyId, BLOB_MAX_LENGTH),
          clip(attempt.bank, BLOB_MAX_LENGTH),
          attempt.environment,
          attempt.searchStrategy,
          attempt.outcome,
          clip(attempt.bankStatus ?? '', BLOB_MAX_LENGTH),
        ],
        doubles: [attempt.latencyMs, attempt.amountCents],
      });
    } catch (error) {
      // Telemetry must never be able to fail a payment the bank already
      // confirmed. The attempt is lost; the money is not.
      logger.warn('attempt_metric_dropped', {
        err: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max);
}
