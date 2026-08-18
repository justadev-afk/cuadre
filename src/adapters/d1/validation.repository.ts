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
import type { FoundPayment, PaymentKind } from '../../application/ports/bank-gateway.ts';
import { epochToIso, VENEZUELA_UTC_OFFSET_MINUTES } from '../../shared/clock.ts';
import { AppError } from '../../shared/errors.ts';
import { isUniqueIndex, readConstraintFailure, type UniqueIndex } from './constraint-error.ts';
import {
  type D1Row,
  epochFromIso,
  flag,
  integer,
  optionalInteger,
  optionalText,
  text,
} from './row.ts';
import type { ValidationCursor } from './validation-cursor.ts';

/** Mirrors the `search_mode` CHECK, which mirrors the gateway's own strategies. */
export type SearchMode = FoundPayment['strategy'];

export type Validation = {
  readonly id: string;
  readonly companyId: string;
  readonly cashierId: string;
  readonly bankAccountId: string;
  readonly bank: string;
  /** Pago móvil or transferencia — the two are found by different searches. */
  readonly kind: PaymentKind;
  /** Copied from the account at insert time, never joined back. */
  readonly isSandbox: boolean;
  readonly controlCode: string;
  /** As the **bank** reported it — normally fuller than what was typed. */
  readonly reference: string;
  /**
   * What this payment is identified by, and what `ux_validations_payment` is
   * unique over. Minted by `paymentKey` in the domain: the bank's canonical
   * reference, or that reference paired with the day when the bank answers with
   * nothing more than the digits it was asked with. The use case supplies it —
   * it cannot be derived from `reference` alone, which is the whole point.
   */
  readonly referenceKey: string;
  readonly amountCents: number;
  readonly currency: string;
  /** A pago móvil always has one; a transferencia never does (0008). */
  readonly payerPhone: string | null;
  readonly sourceBankId: string;
  /** When the bank says the payment happened. */
  readonly trnAt: number;
  readonly latencyMs: number | null;
  readonly searchMode: SearchMode | null;
  readonly idempotencyKey: string;
  /** When the counter confirmed it. */
  readonly createdAt: number;
  /**
   * The cashier's display name, from a LEFT JOIN on `users`. Only the list
   * queries populate it; the insert and idempotency paths never join, so it is
   * null there — hence optional.
   */
  readonly cashierName?: string | null;
  /**
   * The name the merchant gave the connection that received this payment
   * ("Caja principal"), from the same kind of LEFT JOIN — `null` on a
   * connection they never named, and on every path that does not join.
   *
   * The bank is on the row itself; this only tells two affiliations of that one
   * bank apart, which is the whole reason the column exists.
   */
  readonly accountLabel?: string | null;
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
   * One person's work, by id. Omit for everybody's.
   *
   * The company scope is still the `company_id` condition beside it, never this:
   * a cashier id is a uuid a caller supplies, and narrowing by it alone would be
   * a query that can be pointed at another merchant's staff.
   */
  readonly cashierId?: string;
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
  /**
   * The existing charge under this payment key on one of these accounts, if any
   * — the counter's "already cobrado?" check. It runs *after* the bank answers,
   * because the key is built from the bank's own reference: six digits typed at
   * a till identify nothing, so there is nothing to look up until the bank has
   * said which payment they belong to. Carries the cashier's name (the LEFT
   * JOIN), so the till can say who charged it and when.
   */
  findChargedPayment(
    bankAccountIds: readonly string[],
    referenceKey: string,
  ): Promise<Validation | null>;
}

export type DailyTotalsQuery = {
  readonly companyId: string;
  readonly from: number;
  readonly to: number;
};

/**
 * Unique over the payment *key*, not over the reference on the row: two
 * spellings of one payment must still collide here, and a bank that answers with
 * a six-digit tail needs the day folded in to say anything at all. See
 * `paymentKey`.
 */
const PAYMENT_INDEX: UniqueIndex = {
  name: 'ux_validations_payment',
  columns: ['validations.bank_account_id', 'validations.reference_key'],
};
const CONTROL_INDEX: UniqueIndex = {
  name: 'ux_validations_control',
  columns: ['validations.company_id', 'validations.control_code'],
};
const IDEMPOTENCY_INDEX: UniqueIndex = {
  name: 'ux_validations_idempotency',
  columns: ['validations.idempotency_key'],
};

const COLUMNS = `id, company_id, cashier_id, bank_account_id, bank, kind, is_sandbox,
                 control_code, reference, reference_key, amount_cents, currency,
                 payer_phone, source_bank_id, trn_at, latency_ms, search_mode,
                 idempotency_key, created_at`;

/**
 * The list columns, aliased for the two LEFT JOINs: the cashier's name, and the
 * label the merchant gave the connection that received the payment.
 */
const LIST_COLUMNS = `v.id, v.company_id, v.cashier_id, v.bank_account_id, v.bank, v.kind,
                 v.is_sandbox, v.control_code, v.reference, v.reference_key, v.amount_cents,
                 v.currency, v.payer_phone, v.source_bank_id, v.trn_at, v.latency_ms,
                 v.search_mode, v.idempotency_key, v.created_at, u.name AS cashier_name,
                 a.label AS account_label`;

/**
 * Both joins are LEFT, and for the same reason: a validation outlives the rows
 * it points at. A cashier who left still names the payments they confirmed, and
 * a connection the merchant removed still received the ones it received — an
 * INNER JOIN would make either disappearance delete history from the screen.
 */
const LIST_JOINS = `LEFT JOIN users u ON u.id = v.cashier_id
           LEFT JOIN bank_accounts a ON a.id = v.bank_account_id`;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** A SQLite modifier that shifts the stored UTC timestamp to the counter's day. */
const VENEZUELA_DAY_MODIFIER = `${VENEZUELA_UTC_OFFSET_MINUTES} minutes`;

export class D1ValidationRepository implements ValidationRepository {
  constructor(private readonly db: D1Database) {}

  async findByIdempotencyKey(key: string): Promise<Validation | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM validations WHERE idempotency_key = ?`)
      .bind(key)
      .first<D1Row>();
    return row === null ? null : toValidation(row);
  }

  async findChargedPayment(
    bankAccountIds: readonly string[],
    referenceKey: string,
  ): Promise<Validation | null> {
    if (bankAccountIds.length === 0) return null;
    // Matched on the (bank_account_id, reference_key) unique columns exactly, so
    // a hit is unambiguous and this never refuses a genuine new charge; the
    // authoritative INSERT stays the arbiter of the race either way.
    const placeholders = bankAccountIds.map(() => '?').join(', ');
    const row = await this.db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM validations v
           ${LIST_JOINS}
          WHERE v.reference_key = ? AND v.bank_account_id IN (${placeholders})
          LIMIT 1`,
      )
      .bind(referenceKey, ...bankAccountIds)
      .first<D1Row>();
    return row === null ? null : toValidation(row);
  }

  async insert(input: NewValidation): Promise<InsertResult> {
    try {
      const row = await this.db
        .prepare(
          `INSERT INTO validations
               (id, company_id, cashier_id, bank_account_id, bank, kind, is_sandbox,
                control_code, reference, reference_key, amount_cents, currency,
                payer_phone, source_bank_id, trn_at, latency_ms, search_mode,
                idempotency_key, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING ${COLUMNS}`,
        )
        .bind(
          input.id,
          input.companyId,
          input.cashierId,
          input.bankAccountId,
          input.bank,
          input.kind,
          input.isSandbox ? 1 : 0,
          input.controlCode,
          input.reference,
          input.referenceKey,
          input.amountCents,
          input.currency,
          input.payerPhone,
          input.sourceBankId,
          epochToIso(input.trnAt),
          input.latencyMs,
          input.searchMode,
          input.idempotencyKey,
          epochToIso(input.createdAt),
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
        `SELECT date(created_at, ?) AS local_date,
                  COUNT(*) AS total_count,
                  SUM(amount_cents) AS total_amount_cents
             FROM validations
            WHERE company_id = ? AND is_sandbox = 0
              AND created_at >= ? AND created_at <= ?
            GROUP BY local_date
            ORDER BY local_date DESC`,
      )
      .bind(VENEZUELA_DAY_MODIFIER, query.companyId, epochToIso(query.from), epochToIso(query.to))
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
    // Timestamps are stored as ISO-8601 UTC text, which sorts lexicographically
    // in the same order as chronologically — so the epoch bounds and cursor just
    // convert to ISO and every comparison and ORDER BY keeps working.
    const conditions = [`v.${ownerColumn} = ?`, 'v.created_at >= ?', 'v.created_at <= ?'];
    const args: unknown[] = [ownerId, epochToIso(query.from), epochToIso(query.to)];

    if (query.isSandbox !== undefined) {
      conditions.push('v.is_sandbox = ?');
      args.push(query.isSandbox ? 1 : 0);
    }

    // Only the company list asks by cashier; the cashier's own list *is* keyed by
    // one ('cashier_id' is its owner column), so it never sets this.
    if (ownerColumn === 'company_id' && 'cashierId' in query && query.cashierId !== undefined) {
      conditions.push('v.cashier_id = ?');
      args.push(query.cashierId);
    }

    if (query.cursor !== undefined) {
      conditions.push('(v.created_at < ? OR (v.created_at = ? AND v.id < ?))');
      const cursorAt = epochToIso(query.cursor.createdAt);
      args.push(cursorAt, cursorAt, query.cursor.id);
    }

    // One row past the page, so "is there a next page?" costs no second query.
    const result = await this.db
      .prepare(
        `SELECT ${LIST_COLUMNS} FROM validations v
           ${LIST_JOINS}
          WHERE ${conditions.join(' AND ')}
          ORDER BY v.created_at DESC, v.id DESC
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
    kind: toPaymentKind(text(row, 'kind')),
    isSandbox: flag(row, 'is_sandbox'),
    controlCode: text(row, 'control_code'),
    reference: text(row, 'reference'),
    referenceKey: text(row, 'reference_key'),
    amountCents: integer(row, 'amount_cents'),
    currency: text(row, 'currency'),
    payerPhone: optionalText(row, 'payer_phone'),
    sourceBankId: text(row, 'source_bank_id'),
    trnAt: epochFromIso(row, 'trn_at'),
    latencyMs: optionalInteger(row, 'latency_ms'),
    searchMode: toSearchMode(optionalText(row, 'search_mode')),
    idempotencyKey: text(row, 'idempotency_key'),
    createdAt: epochFromIso(row, 'created_at'),
    // Present only on list rows (the LEFT JOINs); absent → null on other paths.
    cashierName: optionalText(row, 'cashier_name'),
    accountLabel: optionalText(row, 'account_label'),
  };
}

/**
 * Fails closed to the kind every row had before 0008. A row whose kind is
 * unreadable is still a payment; reading it as a transferencia would tell a
 * merchant their pago móvil was something else.
 */
function toPaymentKind(value: string): PaymentKind {
  return value === 'transferencia' ? 'transferencia' : 'pago_movil';
}

/**
 * An unrecognised mode reads as "we do not know how this was found" rather than
 * as one of the two we do know. This column is analytics, so guessing it wrong
 * would quietly bias the answer to "is the exact-reference route degrading?".
 */
function toSearchMode(value: string | null): SearchMode | null {
  if (
    value === 'exact_reference' ||
    value === 'reference_tail_and_phone' ||
    value === 'reference_tail_and_account'
  ) {
    return value;
  }
  return null;
}
