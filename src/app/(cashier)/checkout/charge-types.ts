/**
 * Types for the checkout flow. Split from `actions.ts` because a `'use server'`
 * module may only export async functions — a type beside the action fails the
 * RSC build. The `chargeAction` in `actions.ts` returns `ChargeOutcome`; the
 * form imports these to render it.
 */
import type { BankEnvironment } from '../../../application/ports/bank-gateway.ts';
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
  readonly reference: string;
  readonly payerPhone: string;
  readonly sourceBankId: string;
  readonly amountCents: number;
  /**
   * One per submission, minted in the browser. *Reintentar* on the same typed
   * data reuses it, so a payment that lands between two attempts is charged
   * once and reads back with the same control code.
   */
  readonly idempotencyKey: string;
  /**
   * Which of the company's accounts answers. The page resolves it (production
   * when there is one, sandbox otherwise) and it is safe to carry through the
   * client: the use case scopes by `companyId`, so the worst a tampered value
   * reaches is this company's *own* sandbox account — which never holds the
   * customer's real payment, so nothing false can be confirmed with it.
   */
  readonly environment: BankEnvironment;
};

/** The confirmed payment, as the receipt on screen 17 states it. */
export type ConfirmedCharge = {
  readonly controlCode: string;
  readonly reference: string;
  readonly amountCents: number;
  readonly payerPhone: string;
  readonly createdAt: number;
  readonly isSandbox: boolean;
  readonly latencyMs: number | null;
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
  | { readonly status: 'already_charged' }
  | { readonly status: 'failed'; readonly failure: ValidatePaymentFailure };
