/**
 * Whether the bank's movement is the payment the cashier is trying to charge.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  APPROVAL IS BORN FROM THE BANK'S MOVEMENT, NEVER FROM WHAT WAS TYPED ON
 *  SCREEN. Everything in `expected` is a claim; only `movement` is evidence.
 *  Nothing in this file may ever approve on the strength of the claim alone,
 *  and `matchPayment(null, …)` is the honest "the bank does not report this",
 *  not a soft yes.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * This is the last gate before a row lands in `validations`, and a row there
 * *is* a charged payment. Every rule below must hold; there is no tolerance,
 * no rounding and no "close enough".
 */
import { isSupportedCurrency } from './money.ts';

/**
 * The minimum a movement must carry to be judged. Structurally compatible with
 * `BankMovement` from `src/application/ports/bank-gateway.ts` but declared
 * here, because the domain does not import from the application layer — and
 * because naming the four fields that decide a charge is itself the
 * documentation of what a charge depends on.
 */
export type MatchableMovement = {
  readonly reference: string;
  /** Integer cents. A float here can never approve; see `sameAmount`. */
  readonly amountCents: number;
  /** As the bank wrote it, trailing space and all. */
  readonly currency: string;
  /** Money in for the merchant. A debit is never a payment received. */
  readonly isCredit: boolean;
};

/** What the counter claims. A claim, never evidence. */
export type ExpectedPayment = {
  readonly reference: string;
  readonly amountCents: number;
};

export type RejectionReason =
  | 'amount_mismatch'
  | 'not_a_credit'
  | 'unsupported_currency'
  | 'reference_mismatch';

export type PaymentVerdict =
  | { readonly kind: 'approved' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'rejected'; readonly reason: RejectionReason };

export type MatchInput = {
  /** `null` when the bank simply has nothing under that reference yet. */
  readonly movement: MatchableMovement | null;
  readonly expected: ExpectedPayment;
  /**
   * Epoch seconds, from the `Clock` port. No rule below reads it today; it is
   * in the input because a verdict must be a function of an explicit instant
   * and never of the process clock — that is the whole reason this layer is
   * pure. A settlement-window rule lands here, not at a dozen call sites.
   */
  readonly now: number;
};

/**
 * Order matters, and it runs from "this is not a payment to us at all" down to
 * "this is the right payment for the wrong money", so a movement failing
 * several rules reports the most fundamental one. The counter reads the reason
 * aloud to a customer; 'not_a_credit' on an outgoing transfer is a better
 * thing to say than 'amount_mismatch' on the same row.
 */
export function matchPayment({ movement, expected }: MatchInput): PaymentVerdict {
  if (movement === null) return { kind: 'not_found' };
  if (!movement.isCredit) return rejected('not_a_credit');
  if (!isSupportedCurrency(movement.currency)) return rejected('unsupported_currency');
  if (!sameReference(movement.reference, expected.reference)) return rejected('reference_mismatch');
  if (!sameAmount(movement.amountCents, expected.amountCents)) return rejected('amount_mismatch');
  return { kind: 'approved' };
}

function rejected(reason: RejectionReason): PaymentVerdict {
  return { kind: 'rejected', reason };
}

/**
 * Exact, in integer cents, with no tolerance whatsoever — and a guard that a
 * non-integer never reaches the comparison. `0.1 + 0.2` cents is not a
 * quantity of money, so a value that is not a safe integer is refused rather
 * than compared: `===` on two doubles that are each nearly right is exactly
 * the accident this codebase counts in cents to avoid.
 *
 * The expected side must also be positive. `validations.amount_cents` carries
 * `CHECK (amount_cents > 0)`; a zero-bolívar charge is a bug upstream, and
 * approving it would put a row the schema refuses into the write path.
 */
function sameAmount(actual: number, expected: number): boolean {
  if (!Number.isSafeInteger(actual) || !Number.isSafeInteger(expected)) return false;
  if (expected <= 0) return false;
  return actual === expected;
}

/**
 * References are numeric handles a customer reads off a receipt, and banks pad
 * them to their own widths — the same payment comes back as '0000123456' from
 * one and '123456' from another, and a cashier copies whichever is printed.
 * Comparing those as raw strings would reject payments that are genuinely
 * there, so both sides are reduced to the same canonical digits first.
 *
 * This is the only place any leniency exists, and it is leniency about
 * *formatting*, not about identity: two different references never fold onto
 * each other, because stripping leading zeros is injective over the strings
 * that remain. An empty reference matches nothing at all, including another
 * empty one.
 */
function sameReference(actual: string, expected: string): boolean {
  const a = canonicalReference(actual);
  const b = canonicalReference(expected);
  return a !== '' && a === b;
}

function canonicalReference(reference: string): string {
  const compact = reference.replace(/\s/g, '').toUpperCase();
  // Keep the last digit: '000' is the reference zero, not the empty string.
  return compact.replace(/^0+(?=.)/, '');
}
