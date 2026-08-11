/**
 * Types for the checkout flow. Split from `actions.ts` because a `'use server'`
 * module may only export async functions — a type beside the action fails the
 * RSC build. The `chargeAction` in `actions.ts` returns `ChargeOutcome`; the
 * form imports these to render it.
 */
import type { PaymentKind } from '../../../application/ports/bank-gateway.ts';
import type { ValidatePaymentFailure } from '../../../application/validations/validate-payment.ts';
import type { RejectionReason } from '../../../domain/payment-match.ts';

/**
 * What the counter sends. Everything here is a *claim* — the use case compares
 * it against the movement the bank returns and approves nothing on its word.
 *
 * `companyId`, `cashierId` and `sessionId` are deliberately absent: they come
 * from the cookie on this side, because a form field carrying a company id is a
 * form field somebody can retype.
 */
export type ChargeInput = {
  /** Which form was submitted. The bank decides what each kind may carry. */
  readonly kind: PaymentKind;
  /** The last digits of the reference — as many as the kind asks for. */
  readonly reference: string;
  /** A pago móvil is made from a phone; a transferencia carries none. */
  readonly payerPhone: string | null;
  /** A transferencia's receiving account, full; a pago móvil carries none. */
  readonly receivingAccount: string | null;
  readonly sourceBankId: string;
  readonly amountCents: number;
  /**
   * The day the customer made the payment, `YYYY-MM-DD`, for a kind that takes
   * one — a pago móvil is searched within it, so a payment made last night and
   * presented this morning is only findable because this field exists. Null for
   * a transferencia, where sending a date makes the bank find nothing.
   */
  readonly paymentDate: string | null;
  /**
   * One per submission, minted in the browser. *Reintentar* on the same typed
   * data reuses it, so a payment that lands between two attempts is charged
   * once and reads back with the same control code.
   */
  readonly idempotencyKey: string;
  /**
   * Which of the company's connected banks receives — the "banco receptor"
   * dropdown. Safe to carry through the client: the use case scopes by
   * `companyId`, so a tampered id reaches at worst this company's own
   * connection, and a sandbox one never holds a customer's real payment.
   */
  readonly bankAccountId: string;
};

/** The confirmed payment, as the receipt on screen 17 states it. */
export type ConfirmedCharge = {
  readonly controlCode: string;
  readonly kind: PaymentKind;
  /** The bank's own reference — normally fuller than what the cashier typed. */
  readonly reference: string;
  readonly amountCents: number;
  /** Null for a transferencia: there is no payer phone to print. */
  readonly payerPhone: string | null;
  /**
   * When the **bank** says the payment happened, epoch seconds — not when it was
   * charged. The two differ by design: a customer pays at night and presents the
   * receipt in the morning, and the day that settles an argument is theirs, so
   * the counter and the printed ticket both state it.
   */
  readonly paidAt: number;
  readonly createdAt: number;
  readonly isSandbox: boolean;
  readonly latencyMs: number | null;
  /** Which connected bank received it — the counter shows the name beside it. */
  readonly bankAccountId: string;
};

/**
 * Four of these are answers and one is a fault, and the screen says so
 * differently. `not_found` is an answer: the bank does not report the payment
 * *yet*, which is *Todavía no aparece* with a *Reintentar* beside it and never
 * the word "rechazado".
 */
export type ChargeOutcome =
  | { readonly status: 'confirmed'; readonly charge: ConfirmedCharge }
  | { readonly status: 'not_found' }
  | { readonly status: 'rejected'; readonly reason: RejectionReason }
  | {
      readonly status: 'already_charged';
      /** The cashier who charged it first, and when — for the counter's copy. */
      readonly by: string | null;
      readonly at: number;
    }
  | { readonly status: 'failed'; readonly failure: ValidatePaymentFailure };

/** One row of the transferencia form's "cuenta" dropdown. */
export type ReceivingAccountView = {
  /** The full number, sent back with the claim — the bank refuses a masked one. */
  readonly number: string;
  /** What the cashier reads: '···· 5394'. */
  readonly masked: string;
};
