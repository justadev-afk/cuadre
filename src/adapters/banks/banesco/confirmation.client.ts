/**
 * Confirmation of Transactions: the endpoint that answers "did this pago móvil
 * land?".
 *
 * One URL, two questions, told apart only by the shape of the `transaction`
 * object we put in the envelope. **Both shapes are what QA actually answers**,
 * probed field by field on 2026-08-11, not what the manual lists:
 *
 *   pago móvil     reference tail + `phoneNum` + `bankId` + `startDt`
 *                  (manual §VI example c). Drop any of the four and the bank
 *                  answers `70001 · sin resultados`.
 *
 *   transferencia  the **whole** reference + `accountId`, the merchant's own
 *                  receiving account. The manual lists `startDt` and `bankId` among
 *                  that modality's required fields; sending `startDt` makes the
 *                  search **fail** — ref 150496 on account …5394 returns the
 *                  movement without it and `70001` with it, on the very date the
 *                  bank itself reports for that movement. `bankId` is harmless
 *                  and travels, because the payer's bank is worth telling them.
 *
 * "No results" comes back from here as its own outcome rather than as a
 * failure, because it is not a fault — it is *todavía no aparece*.
 */
import type {
  BankEnvironment,
  BankFailure,
  BankMovement,
} from '../../../application/ports/bank-gateway.ts';
import { logger } from '../../../shared/logger.ts';
import { bankFetch, parseJsonBody } from '../http.ts';
import { debugBanescoCall } from './debug.ts';
import { BANESCO_ID, banescoEndpoints } from './endpoints.ts';
import { type BanescoDevice, dataRequest } from './envelope.ts';
import { classifyStatus, failureForHttpStatus } from './status-codes.ts';
import { ConfirmationReply, toMovements } from './transaction-detail.ts';

/**
 * How much of the reference either search matches on. The bank's number, and the
 * same one the gateway publishes per kind as `referenceDigits` so the counter's
 * field and this request cannot disagree about how many digits a payment is
 * asked by.
 */
export const REFERENCE_TAIL_DIGITS = 6;

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

export type PagoMovilQuery = {
  /** The reference as typed. Only its last six digits travel. */
  reference: string;
  /** Already normalised by the domain to the bank's form, e.g. '584143125566'. */
  payerPhone: string;
  /** Sudeban code of the paying bank, four digits, e.g. '0134'. */
  sourceBankId: string;
  /** `YYYY-MM-DD`, Venezuela local — the day the customer made the payment. */
  onDate: string;
};

export type TransferenciaQuery = {
  /** The whole reference the customer's receipt carries. Sent as it is. */
  reference: string;
  /** The merchant's receiving account, **full**: a masked one is refused (400). */
  receivingAccount: string;
  /** Sudeban code of the paying bank. Optional to the bank, sent when known. */
  sourceBankId: string | null;
};

export interface ConfirmationClient {
  findPagoMovil(call: BanescoConfirmationCall, query: PagoMovilQuery): Promise<ConfirmationOutcome>;
  findTransferencia(
    call: BanescoConfirmationCall,
    query: TransferenciaQuery,
  ): Promise<ConfirmationOutcome>;
}

export class BanescoConfirmationClient implements ConfirmationClient {
  constructor(
    private readonly device: BanescoDevice,
    private readonly userAgent: string,
    /** `BANESCO_DEBUG` — print method, path and body to the console. Local only. */
    private readonly debug: boolean,
  ) {}

  /**
   * The four fields the bank asks for, and no others.
   *
   * The bank's desk told us on 2026-08-11 that they were not seeing the payer's
   * bank code or phone arrive. They were not: the old flow asked by exact
   * reference first and only fell back to this shape, so a search that answered
   * "sin resultados" on the first call never sent either field. There is one
   * call now, and it always carries all four.
   */
  async findPagoMovil(
    call: BanescoConfirmationCall,
    query: PagoMovilQuery,
  ): Promise<ConfirmationOutcome> {
    return this.post(call, 'pago_movil', {
      referenceNumber: referenceTail(query.reference),
      phoneNum: query.payerPhone,
      bankId: query.sourceBankId,
      startDt: query.onDate,
    });
  }

  /**
   * The reference tail and the receiving account — and **no date**.
   *
   * The omission is the whole subtlety of this method and it is load-bearing, so
   * it is not left to a caller to remember: adding `startDt` turns a movement
   * the bank had just returned into `70001 · sin resultados`, verified on the
   * transferencia's own reported date. Whatever the manual says, this shape is
   * the one that answers.
   */
  async findTransferencia(
    call: BanescoConfirmationCall,
    query: TransferenciaQuery,
  ): Promise<ConfirmationOutcome> {
    const transaction: TransactionQuery = {
      // Whole, not trimmed: this modality is asked with the full reference.
      // The bank answers `150496` to `00000150496` either way — its own
      // unpadded spelling — which `sameReference` folds.
      referenceNumber: query.reference.replace(/\D/g, ''),
      accountId: query.receivingAccount,
    };
    if (query.sourceBankId !== null) transaction.bankId = query.sourceBankId;

    return this.post(call, 'transferencia', transaction);
  }

  // ── the wire ─────────────────────────────────────────────────────────────

  private async post(
    call: BanescoConfirmationCall,
    mode: string,
    transaction: TransactionQuery,
  ): Promise<ConfirmationOutcome> {
    const endpoints = banescoEndpoints(call.environment);
    const where = { bank: BANESCO_ID, environment: call.environment, mode };
    const body = JSON.stringify(
      dataRequest({
        device: this.device,
        securityAuth: { sessionId: call.sessionId },
        transaction,
      }),
    );

    debugBanescoCall(this.debug, { method: 'POST', url: endpoints.payment, body });

    const outcome = await bankFetch(endpoints.payment, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${call.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': this.userAgent,
      },
      body,
    });

    if (outcome.kind === 'timeout') {
      logger.warn('banesco_confirmation_timeout', { ...where, timeoutMs: outcome.timeoutMs });
      return { kind: 'failure', failure: 'timeout' };
    }

    if (outcome.kind === 'network') {
      logger.warn('banesco_confirmation_unreachable', { ...where, detail: outcome.detail });
      return { kind: 'failure', failure: 'unavailable' };
    }

    debugBanescoCall(this.debug, {
      method: 'POST',
      url: endpoints.payment,
      status: outcome.status,
      response: outcome.body,
    });

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
}

/** The `transaction` object, whichever question is being asked. */
type TransactionQuery = Record<string, string>;

/**
 * The last six digits, whatever arrived. The counter's field already caps the
 * input at that, so this only ever fires for a cashier who pasted the whole
 * reference — in which case the tail is exactly what the bank wants anyway.
 */
function referenceTail(reference: string): string {
  return reference.replace(/\D/g, '').slice(-REFERENCE_TAIL_DIGITS);
}
