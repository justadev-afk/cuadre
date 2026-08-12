/**
 * Confirmation of Transactions: the endpoint that answers "did this pago móvil
 * land?".
 *
 * One URL, **three** questions, told apart only by the shape of the
 * `transaction` object we put in the envelope:
 *
 *   pago móvil                  reference tail + `phoneNum` + `bankId` +
 *                               `startDt` (manual §VI). Drop any of the four and
 *                               the bank answers `70001 · sin resultados`.
 *                               Verified against QA on 2026-08-11.
 *
 *   transferencia Banesco→      the **whole** reference + `accountId`, the
 *   Banesco                     merchant's own receiving account, and **no
 *                               date**. Verified against QA: ref 150496 on
 *                               account …5394 returns the movement without
 *                               `startDt` and `70001` with it, on the very date
 *                               the bank itself reports for that movement.
 *
 *   transferencia               the reference **tail** + `accountId` +
 *   interbancaria               `bankId` + `startDt` — the modality v1.3 of the
 *                               manual added "para solo Transferencias
 *                               Interbancarias", and the one the bank's desk
 *                               asked for on 2026-08-12 after seeing only the
 *                               internal shape in our traffic. QA holds no
 *                               interbank movement to prove it against (the bank
 *                               said so in the meeting), so this shape is the
 *                               manual's, faithfully, rather than something we
 *                               have watched answer.
 *
 * Which of the two transferencia shapes travels is decided by one field — the
 * payer's Sudeban code — and by nothing on the screen: a cashier picks the
 * customer's bank, not a modality.
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
import { BANESCO_ID, BANESCO_SUDEBAN_CODE, banescoEndpoints } from './endpoints.ts';
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
  /**
   * The whole reference the customer's receipt carries. Sent as it is to the
   * internal modality, trimmed to its tail for the interbank one.
   */
  reference: string;
  /** The merchant's receiving account, **full**: a masked one is refused (400). */
  receivingAccount: string;
  /**
   * Sudeban code of the paying bank. Never optional here: it is what chooses
   * between the two transferencia modalities.
   */
  sourceBankId: string;
  /**
   * `YYYY-MM-DD`, Venezuela local. Travels on an interbank transferencia and is
   * **dropped** on a Banesco→Banesco one, where sending it finds nothing. The
   * counter collects it either way — see `findTransferencia`.
   */
  onDate: string;
};

/**
 * Did the money come from another entity? The one rule that chooses a
 * transferencia's modality, written once so the shape of the request and the
 * name it is recorded under cannot disagree about it (§11).
 */
export function isInterbankTransferencia(sourceBankId: string): boolean {
  return sourceBankId !== BANESCO_SUDEBAN_CODE;
}

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
   * A transferencia, in whichever of its **two** modalities the payer's bank
   * calls for. The choice is made here and nowhere else — a caller passes what
   * the cashier collected and this decides what the bank is asked.
   *
   *  - **From another entity** (interbancaria): the reference *tail*, the
   *    receiving account, the payer's bank and the date. This is the modality
   *    the manual's v1.3 added for interbank transfers specifically, and the one
   *    Banesco asked for on 2026-08-12 — they were seeing only the internal
   *    shape arrive.
   *  - **From Banesco itself**: the *whole* reference and the account, with
   *    **no date**. That omission is load-bearing and is why it is not left to a
   *    caller to remember: adding `startDt` turns a movement the bank had just
   *    returned into `70001 · sin resultados`, verified on the transferencia's
   *    own reported date.
   *
   * So the date is collected for both and travels for one. A cashier is asked
   * for the day of the payment whichever bank the customer used — the field is
   * not a modality switch in disguise — and it is dropped, here, when the bank
   * it is going to would refuse it.
   */
  async findTransferencia(
    call: BanescoConfirmationCall,
    query: TransferenciaQuery,
  ): Promise<ConfirmationOutcome> {
    const interbank = isInterbankTransferencia(query.sourceBankId);

    // The bank answers `150496` to both `00000150496` and `150496` — its own
    // unpadded spelling — which `sameReference` folds either way.
    const transaction: TransactionQuery = interbank
      ? {
          referenceNumber: referenceTail(query.reference),
          accountId: query.receivingAccount,
          bankId: query.sourceBankId,
          startDt: query.onDate,
        }
      : {
          referenceNumber: query.reference.replace(/\D/g, ''),
          accountId: query.receivingAccount,
          bankId: query.sourceBankId,
        };

    return this.post(
      call,
      interbank ? 'transferencia_interbancaria' : 'transferencia_banesco',
      transaction,
    );
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
