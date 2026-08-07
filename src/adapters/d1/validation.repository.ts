/**
 * Confirmed payments. A row here IS a payment the bank told us had landed, so
 * this file has no "status" to filter on and no failed attempts to hide.
 *
 * The three unique indexes are the product's safety rules expressed as
 * mechanism, and `insert` exists to tell them apart:
 *
 *   ux_validations_payment      one payment is charged once, ever
 *   ux_validations_control      a control code is unambiguous in its company
 *   ux_validations_idempotency  a retried POST gets the same answer back
 *
 * Every one of them can only be enforced by the INSERT itself. Checking first
 * and inserting second is the bug: two cashiers racing the same reference both
 * read "not charged yet" and both charge.
 */
import type { FoundPayment } from '../../application/ports/bank-gateway.ts';
import { VENEZUELA_UTC_OFFSET_MINUTES } from '../../shared/clock.ts';
import { AppError } from '../../shared/errors.ts';
import { isUniqueIndex, readConstraintFailure, type UniqueIndex } from './constraint-error.ts';
import { type D1Row, flag, integer, optionalInteger, optionalText, text } from './row.ts';
import type { ValidationCursor } from './validation-cursor.ts';

/** Mirrors the `search_mode` CHECK, which mirrors the gateway's own strategies. */
export type SearchMode = FoundPayment['strategy'];

export type Validation = {
  readonly id: string;
  readonly companyId: string;
  readonly cashierId: string;
  readonly bankAccountId: string;
  readonly bank: string;
  /** Copied from the account at insert time, never joined back. */
  readonly isSandbox: boolean;
  readonly controlCode: string;
  readonly reference: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly payerPhone: string;
  readonly sourceBankId: string;
  /** When the bank says the payment happened. */
  readonly trnAt: number;
  readonly latencyMs: number | null;
  readonly searchMode: SearchMode | null;
  readonly idempotencyKey: string;
  /** When the counter confirmed it. */
  readonly createdAt: number;
};

/**
 * Every column is supplied. The id, the control code and both timestamps are
 * minted by the use case, which is the layer holding the `IdGen` and the
 * `Clock` — a repository that invented any of them would be untestable and
 * would put a `Date.now()` between the bank's answer and the row that records
 * it.
 */
export type NewValidation = Validation;

export type InsertResult =
  | { readonly outcome: 'inserted'; readonly validation: Validation }
  | { readonly outcome: 'duplicate_payment' }
  | { readonly outcome: 'control_code_taken' }
  | { readonly outcome: 'idempotent_replay' };

export type ValidationListQuery = {
  readonly companyId: string;
  /** Omit for both. The company panel's sandbox toggle. */
  readonly isSandbox?: boolean;
  /**
   * Epoch seconds, inclusive. Not optional: an unbounded list of a company's
   * whole history is a table scan, and the panel always has a range on screen.
   */
  readonly from: number;
  readonly to: number;
  readonly cursor?: ValidationCursor;
  readonly limit?: number;
};

export type CashierListQuery = Omit<ValidationListQuery, 'companyId'> & {
  readonly cashierId: string;
};

export type ValidationPage = {
  readonly items: readonly Validation[];
  /** `null` when this was the last page. */
  readonly nextCursor: ValidationCursor | null;
};

export type DailyTotal = {
  /** `YYYY-MM-DD` in Venezuela local time. */
  readonly date: string;
  readonly count: number;
  readonly amountCents: number;
};

export interface ValidationRepository {
  insert(input: NewValidation): Promise<InsertResult>;
  /** The retried POST's answer: the same validation, and the same control code. */
  findByIdempotencyKey(key: string): Promise<Validation | null>;
  listByCompany(query: ValidationListQuery): Promise<ValidationPage>;
  listByCashier(query: CashierListQuery): Promise<ValidationPage>;
  /** Real money only — sandbox is excluded, always. */
  dailyTotals(query: DailyTotalsQuery): Promise<readonly DailyTotal[]>;
}

export type DailyTotalsQuery = {
  readonly companyId: string;
  readonly from: number;
  readonly to: number;
};

const PAYMENT_INDEX: UniqueIndex = {
  name: 'ux_validations_payment',
  columns: ['validations.bank_account_id', 'validations.reference'],
};
const CONTROL_INDEX: UniqueIndex = {
  name: 'ux_validations_control',
  columns: ['validations.company_id', 'validations.control_code'],
};
const IDEMPOTENCY_INDEX: UniqueIndex = {
  name: 'ux_validations_idempotency',
  columns: ['validations.idempotency_key'],
};

const COLUMNS = `id, company_id, cashier_id, bank_account_id, bank, is_sandbox,
                 control_code, reference, amount_cents, currency, payer_phone,
                 source_bank_id, trn_at, latency_ms, search_mode,
                 idempotency_key, created_at`;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** `date(created_at + this, 'unixepoch')` is the counter's day, not UTC's. */
const LOCAL_DAY_OFFSET_SECONDS = VENEZUELA_UTC_OFFSET_MINUTES * 60;

export class D1ValidationRepository implements ValidationRepository {
  constructor(private readonly db: D1Database) {}

  async findByIdempotencyKey(key: string): Promise<Validation | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM validations WHERE idempotency_key = ?`)
      .bind(key)
      .first<D1Row>();
    return row === null ? null : toValidation(row);
  }

  async insert(input: NewValidation): Promise<InsertResult> {
    try {
      const row = await this.db
        .prepare(
          `INSERT INTO validations
               (id, company_id, cashier_id, bank_account_id, bank, is_sandbox,
                control_code, reference, amount_cents, currency, payer_phone,
                source_bank_id, trn_at, latency_ms, search_mode,
                idempotency_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING ${COLUMNS}`,
        )
        .bind(
          input.id,
          input.companyId,
          input.cashierId,
          input.bankAccountId,
          input.bank,
          input.isSandbox ? 1 : 0,
          input.controlCode,
          input.reference,
          input.amountCents,
          input.currency,
          input.payerPhone,
          input.sourceBankId,
          input.trnAt,
          input.latencyMs,
          input.searchMode,
          input.idempotencyKey,
          input.createdAt,
        )
        .first<D1Row>();

      if (row === null) throw new AppError('internal', 'validation insert returned no row');
      return { outcome: 'inserted', validation: toValidation(row) };
    } catch (error) {
      return classify(error, input.idempotencyKey, (key) => this.findByIdempotencyKey(key));
    }
  }

  listByCompany(query: ValidationListQuery): Promise<ValidationPage> {
    return this.page('company_id', query.companyId, query);
  }

  listByCashier(query: CashierListQuery): Promise<ValidationPage> {
    return this.page('cashier_id', query.cashierId, query);
  }

  /**
   * Grouped in SQL rather than in JS: the merchant's month is a few thousand
   * rows and streaming them back to bucket them by day would be paying to
   * move data we immediately throw away.
   *
   * The bucket is `created_at` — when the counter confirmed the payment — not
   * `trn_at`. A merchant closing the till asks what *they* took today; the
   * bank's own timestamp is the reconciliation view and belongs to a
   * different report.
   */
  async dailyTotals(query: DailyTotalsQuery): Promise<readonly DailyTotal[]> {
    const result = await this.db
      .prepare(
        `SELECT date(created_at + ?, 'unixepoch') AS local_date,
                  COUNT(*) AS total_count,
                  SUM(amount_cents) AS total_amount_cents
             FROM validations
            WHERE company_id = ? AND is_sandbox = 0
              AND created_at >= ? AND created_at <= ?
            GROUP BY local_date
            ORDER BY local_date DESC`,
      )
      .bind(LOCAL_DAY_OFFSET_SECONDS, query.companyId, query.from, query.to)
      .all<D1Row>();

    return result.results.map((row) => ({
      date: text(row, 'local_date'),
      count: integer(row, 'total_count'),
      amountCents: integer(row, 'total_amount_cents'),
    }));
  }

  private async page(
    ownerColumn: 'company_id' | 'cashier_id',
    ownerId: string,
    query: ValidationListQuery | CashierListQuery,
  ): Promise<ValidationPage> {
    const limit = clamp(query.limit);
    const conditions = [`${ownerColumn} = ?`, 'created_at >= ?', 'created_at <= ?'];
    const args: unknown[] = [ownerId, query.from, query.to];

    if (query.isSandbox !== undefined) {
      conditions.push('is_sandbox = ?');
      args.push(query.isSandbox ? 1 : 0);
    }

    if (query.cursor !== undefined) {
      conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      args.push(query.cursor.createdAt, query.cursor.createdAt, query.cursor.id);
    }

    // One row past the page, so "is there a next page?" costs no second query
    // and never claims one that turns out to be empty.
    const result = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM validations
          WHERE ${conditions.join(' AND ')}
          ORDER BY created_at DESC, id DESC
          LIMIT ?`,
      )
      .bind(...args, limit + 1)
      .all<D1Row>();

    const rows = result.results.slice(0, limit);
    const items = rows.map(toValidation);
    const last = items.at(-1);
    const hasMore = result.results.length > limit;

    return {
      items,
      nextCursor: hasMore && last !== undefined ? { createdAt: last.createdAt, id: last.id } : null,
    };
  }
}

/**
 * Which index refused the row.
 *
 * A genuine retry violates *two* indexes at once — the same idempotency key and
 * the same (account, reference) — and SQLite names only one of them, chosen by
 * its own index ordering. So a payment-index hit is not enough to conclude
 * "already charged": if a row with this idempotency key exists, the caller is
 * the same POST arriving twice and must get its control code back, not a
 * `payment_already_charged`. That extra SELECT only ever runs on the failure
 * path, which is the rare one.
 */
async function classify(
  error: unknown,
  idempotencyKey: string,
  findByKey: (key: string) => Promise<Validation | null>,
): Promise<InsertResult> {
  const failure = readConstraintFailure(error);
  if (failure === null) throw error;

  if (isUniqueIndex(failure, IDEMPOTENCY_INDEX)) return { outcome: 'idempotent_replay' };

  if (isUniqueIndex(failure, PAYMENT_INDEX)) {
    const existing = await findByKey(idempotencyKey);
    return existing === null ? { outcome: 'duplicate_payment' } : { outcome: 'idempotent_replay' };
  }

  // A collision here is our own generator, not the customer's: the caller mints
  // a fresh control code and inserts again.
  if (isUniqueIndex(failure, CONTROL_INDEX)) return { outcome: 'control_code_taken' };

  throw error;
}

function clamp(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

export function toValidation(row: D1Row): Validation {
  return {
    id: text(row, 'id'),
    companyId: text(row, 'company_id'),
    cashierId: text(row, 'cashier_id'),
    bankAccountId: text(row, 'bank_account_id'),
    bank: text(row, 'bank'),
    isSandbox: flag(row, 'is_sandbox'),
    controlCode: text(row, 'control_code'),
    reference: text(row, 'reference'),
    amountCents: integer(row, 'amount_cents'),
    currency: text(row, 'currency'),
    payerPhone: text(row, 'payer_phone'),
    sourceBankId: text(row, 'source_bank_id'),
    trnAt: integer(row, 'trn_at'),
    latencyMs: optionalInteger(row, 'latency_ms'),
    searchMode: toSearchMode(optionalText(row, 'search_mode')),
    idempotencyKey: text(row, 'idempotency_key'),
    createdAt: integer(row, 'created_at'),
  };
}

/**
 * An unrecognised mode reads as "we do not know how this was found" rather than
 * as one of the two we do know. This column is analytics, so guessing it wrong
 * would quietly bias the answer to "is the exact-reference route degrading?".
 */
function toSearchMode(value: string | null): SearchMode | null {
  if (value === 'exact_reference' || value === 'reference_tail_and_phone') return value;
  return null;
}
