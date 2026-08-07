/**
 * Confirmation of Transactions: the endpoint that answers "did this payment
 * land?".
 *
 * One URL, three questions, told apart only by the shape of the `transaction`
 * object we put in the envelope:
 *
 *   exact reference   — the whole reference the customer read off their phone.
 *   reference tail    — the last six digits plus the payer's phone, their
 *                       bank's Sudeban code and the date. The bank's own search
 *                       for a payment whose full reference it has not settled
 *                       under yet; it is the fallback, not the first ask.
 *   account range     — everything on an account between two dates, for the
 *                       reconciliation panel. Never on the checkout path.
 *
 * "No results" comes back from here as its own outcome rather than as a
 * failure, because it is what sends the caller to the next question.
 */
import type {
  BankEnvironment,
  BankFailure,
  BankMovement,
} from '../../../application/ports/bank-gateway.ts';
import { logger } from '../../../shared/logger.ts';
import { bankFetch, parseJsonBody } from '../http.ts';
import { BANESCO_ID, banescoEndpoints } from './endpoints.ts';
import { type BanescoDevice, dataRequest } from './envelope.ts';
import { classifyStatus, failureForHttpStatus } from './status-codes.ts';
import { ConfirmationReply, toMovements } from './transaction-detail.ts';

/** How much of the reference the fallback search matches on. The bank's number. */
const REFERENCE_TAIL_DIGITS = 6;

/** The bank's ceiling for one range query. We never ask for more than two days. */
export const MAX_RANGE_DAYS = 30;

const MILLIS_PER_DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ConfirmationOutcome =
  | { readonly kind: 'movements'; readonly movements: BankMovement[] }
  /** The bank has nothing under that question. An answer, not a fault. */
  | { readonly kind: 'no_results' }
  | { readonly kind: 'failure'; readonly failure: BankFailure };

/**
 * The half of a call that only exists once a session is open. The device
 * envelope and the user agent are the same for every call and belong to the
 * client itself; these three change with the session asking.
 */
export type BanescoConfirmationCall = {
  environment: BankEnvironment;
  accessToken: string;
  /** Travels as `securityAuth.sessionId`, so the bank's desk can correlate. */
  sessionId: string;
};

export type ReferenceTailQuery = {
  reference: string;
  /** Already normalised by the domain to the bank's form, e.g. '584143125566'. */
  payerPhone: string;
  /** Sudeban code of the paying bank, e.g. '0134'. */
  sourceBankId: string;
  /** `YYYY-MM-DD`, Venezuela local. */
  onDate: string;
};

export type AccountRangeQuery = {
  accountId: string;
  /** `YYYY-MM-DD`, inclusive, Venezuela local. */
  from: string;
  to: string;
};

/** The three questions, in the order the gateway asks them. */
export interface ConfirmationClient {
  findByExactReference(
    call: BanescoConfirmationCall,
    reference: string,
  ): Promise<ConfirmationOutcome>;

  findByReferenceTail(
    call: BanescoConfirmationCall,
    query: ReferenceTailQuery,
  ): Promise<ConfirmationOutcome>;

  listByAccountRange(
    call: BanescoConfirmationCall,
    query: AccountRangeQuery,
  ): Promise<ConfirmationOutcome>;
}

export class BanescoConfirmationClient implements ConfirmationClient {
  constructor(
    private readonly device: BanescoDevice,
    private readonly userAgent: string,
  ) {}

  async findByExactReference(
    call: BanescoConfirmationCall,
    reference: string,
  ): Promise<ConfirmationOutcome> {
    return settled(await this.post(call, 'exact_reference', { referenceNumber: reference.trim() }));
  }

  async findByReferenceTail(
    call: BanescoConfirmationCall,
    query: ReferenceTailQuery,
  ): Promise<ConfirmationOutcome> {
    return settled(
      await this.post(call, 'reference_tail', {
        referenceNumber: referenceTail(query.reference),
        phoneNum: query.payerPhone,
        bankId: query.sourceBankId,
        startDt: query.onDate,
      }),
    );
  }

  async listByAccountRange(
    call: BanescoConfirmationCall,
    query: AccountRangeQuery,
  ): Promise<ConfirmationOutcome> {
    const span = spanInDays(query.from, query.to);
    if (span === null || span >= MAX_RANGE_DAYS) {
      return { kind: 'failure', failure: 'invalid_input' };
    }

    const outcome = await this.post(call, 'account_range', {
      accountId: query.accountId,
      startDt: query.from,
      endDt: query.to,
    });
    if (outcome.kind !== 'split_range') return outcome;

    // 70005: too much in that window for one reply. We only ever ask for a day or
    // two, so this is the busy account rather than the wide range — one request
    // per day is the whole of the split we can do.
    logger.info('banesco_range_split', { bank: BANESCO_ID, days: span + 1 });
    if (span === 0) {
      logger.warn('banesco_range_unsplittable', { bank: BANESCO_ID, from: query.from });
      return { kind: 'failure', failure: 'unavailable' };
    }

    return this.listDayByDay(call, query);
  }

  // ── the wire ─────────────────────────────────────────────────────────────

  private async post(
    call: BanescoConfirmationCall,
    mode: string,
    transaction: TransactionQuery,
  ): Promise<PostOutcome> {
    const endpoints = banescoEndpoints(call.environment);
    const where = { bank: BANESCO_ID, environment: call.environment, mode };

    const outcome = await bankFetch(endpoints.payment, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${call.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': this.userAgent,
      },
      body: JSON.stringify(
        dataRequest({
          device: this.device,
          securityAuth: { sessionId: call.sessionId },
          transaction,
        }),
      ),
    });

    if (outcome.kind === 'timeout') {
      logger.warn('banesco_confirmation_timeout', { ...where, timeoutMs: outcome.timeoutMs });
      return { kind: 'failure', failure: 'timeout' };
    }

    if (outcome.kind === 'network') {
      logger.warn('banesco_confirmation_unreachable', { ...where, detail: outcome.detail });
      return { kind: 'failure', failure: 'unavailable' };
    }

    const parsed = ConfirmationReply.safeParse(parseJsonBody(outcome.body));
    if (!parsed.success) {
      // Field paths, never values: this body holds references and account numbers.
      logger.error('banesco_confirmation_unreadable', {
        ...where,
        status: outcome.status,
        fields: parsed.error.issues.map((issue) => issue.path.join('.')).join(', '),
      });
      return { kind: 'failure', failure: failureForHttpStatus(outcome.status) };
    }

    const { statusCode } = parsed.data.httpStatus;
    const status = classifyStatus(statusCode);
    if (status.kind === 'no_results') return { kind: 'no_results' };
    if (status.kind === 'split_range') return { kind: 'split_range' };
    if (status.kind === 'failure') {
      logger.warn('banesco_confirmation_failed', {
        ...where,
        statusCode: String(statusCode),
        failure: status.failure,
      });
      return { kind: 'failure', failure: status.failure };
    }

    const details = parsed.data.dataResponse?.transactionDetail ?? [];
    if (details.length === 0) return { kind: 'no_results' };

    const movements = toMovements(details);
    if (!movements) {
      logger.error('banesco_movement_unmappable', { ...where, rows: details.length });
      return { kind: 'failure', failure: 'unavailable' };
    }

    return { kind: 'movements', movements };
  }

  private async listDayByDay(
    call: BanescoConfirmationCall,
    query: AccountRangeQuery,
  ): Promise<ConfirmationOutcome> {
    const movements: BankMovement[] = [];

    for (const day of eachDay(query.from, query.to)) {
      const outcome = await this.post(call, 'account_range_day', {
        accountId: query.accountId,
        startDt: day,
        endDt: day,
      });

      // A single day that still will not fit is the bank's problem to fix, and a
      // half-empty reconciliation is worse than an error nobody can misread.
      if (outcome.kind === 'split_range') return { kind: 'failure', failure: 'unavailable' };
      if (outcome.kind === 'failure') return outcome;
      if (outcome.kind === 'movements') movements.push(...outcome.movements);
    }

    return movements.length === 0 ? { kind: 'no_results' } : { kind: 'movements', movements };
  }
}

/** The `transaction` object, whichever question is being asked. */
type TransactionQuery = Record<string, string>;

type PostOutcome = ConfirmationOutcome | { readonly kind: 'split_range' };

// ── local helpers ──────────────────────────────────────────────────────────

/**
 * "Split the range" is meaningless for a search that carries no range. If the
 * bank ever answers 70005 to one, it is answering a question we did not ask.
 */
function settled(outcome: PostOutcome): ConfirmationOutcome {
  if (outcome.kind !== 'split_range') return outcome;
  logger.error('banesco_unexpected_split_range', { bank: BANESCO_ID });
  return { kind: 'failure', failure: 'unavailable' };
}

function referenceTail(reference: string): string {
  return reference.replace(/\D/g, '').slice(-REFERENCE_TAIL_DIGITS);
}

/** Whole days from `from` to `to`, or `null` if either is not a date or they invert. */
function spanInDays(from: string, to: string): number | null {
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / MILLIS_PER_DAY);
}

function eachDay(from: string, to: string): string[] {
  const last = Date.parse(`${to}T00:00:00Z`);
  const days: string[] = [];
  for (let at = Date.parse(`${from}T00:00:00Z`); at <= last; at += MILLIS_PER_DAY) {
    days.push(new Date(at).toISOString().slice(0, 10));
  }
  return days;
}
