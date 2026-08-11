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
 * Whether the bank's reference and the claimed one are the same payment.
 *
 * Two kinds of leniency, both about *spelling* and neither about identity:
 *
 *  - **Padding.** Banks pad references to their own widths — one payment comes
 *    back as '0000123456' and another bank prints '123456' — so both sides are
 *    reduced to the same canonical digits first. Stripping leading zeros is
 *    injective over what remains, so two different references never fold onto
 *    each other.
 *  - **Tails.** The counter asks with the last few digits (Banesco: six), and
 *    the bank answers with the whole number. One is therefore the suffix of the
 *    other by construction — and checking it here is what makes sure the
 *    movement that came back is an answer to the question that was asked, and
 *    not some other row.
 *
 * The floor is what keeps the tail rule honest: below six digits a shared
 * suffix is a coincidence rather than a payment, so it is refused. An empty
 * reference matches nothing at all, including another empty one.
 *
 * Exported because the Banesco adapter picks its candidate row with the same
 * rule, and a rule that decides money is written once (§11).
 */
export function sameReference(actual: string, expected: string): boolean {
  // Padding first, on the canonical forms: '0000123456' and '123456' are one
  // payment however either side spelled it.
  const canonicalA = canonicalReference(actual);
  const canonicalB = canonicalReference(expected);
  if (canonicalA === '' || canonicalB === '') return false;
  if (canonicalA === canonicalB) return true;

  // Then tails, on the **raw** digits rather than the canonical ones. A tail may
  // legitimately begin with a zero — Banesco's ref 12346090431 is asked for as
  // '090431' — and stripping that zero first would leave five digits, drop it
  // under the floor, and refuse a payment the bank had just handed us.
  const digitsA = actual.replace(/\D/g, '');
  const digitsB = expected.replace(/\D/g, '');
  const shorter = digitsA.length < digitsB.length ? digitsA : digitsB;
  if (shorter.length < MIN_MATCHABLE_DIGITS) return false;
  return digitsA.endsWith(digitsB) || digitsB.endsWith(digitsA);
}

/** Below this a shared suffix is a coincidence, not the same reference. */
const MIN_MATCHABLE_DIGITS = 6;

/**
 * Which spelling of one reference the row keeps — the fuller of the two, never
 * a normalised one.
 *
 * Both sides are the same payment by the time this is asked (`sameReference`
 * said so), so the only question left is which spelling a customer can settle
 * an argument with, and that is whichever carries more digits:
 *
 *  - **Pago móvil.** Six digits are typed, the bank answers with all eleven.
 *    The bank's is fuller, and the receipt shows the same eleven.
 *  - **Transferencia.** The whole reference is typed — `00000150496`, exactly as
 *    the receipt prints it — and Banesco answers `150496`, its own spelling with
 *    the padding dropped. Here the *typed* one is fuller, and storing the bank's
 *    would quietly delete zeros the customer is looking at.
 *
 * Never a merge of the two: a spelling nobody sent is a spelling nobody can
 * check. Identity is not decided here — that is `paymentKey`, which canonicalises
 * both to the same thing either way.
 */
export function fullestReference(reported: string, asTyped: string): string {
  const reportedDigits = reported.replace(/\D/g, '').length;
  const typedDigits = asTyped.replace(/\D/g, '').length;
  return typedDigits > reportedDigits ? asTyped : reported;
}

/**
 * The reference reduced to the one spelling every padding of it shares — and
 * therefore the key a payment is *identified* by, as opposed to the spelling it
 * is *shown* in. `validations.reference` keeps what the cashier typed, zeros and
 * all, because that is what the customer's receipt says; `reference_key` holds
 * this, and it is what `ux_validations_payment` is unique over. Both come from
 * here, so the rule that decides two spellings are one payment cannot drift
 * between the comparison and the index.
 */
export function canonicalReference(reference: string): string {
  const compact = reference.replace(/\s/g, '').toUpperCase();
  // Keep the last digit: '000' is the reference zero, not the empty string.
  return compact.replace(/^0+(?=.)/, '');
}

/**
 * The key one payment is charged under — what `ux_validations_payment` is
 * unique over, and therefore the whole anti-double-charge mechanism.
 *
 * It is the bank's own reference, canonicalised, **and the day it happened
 * whenever that reference is only a tail**. Banesco is asked with the last six
 * digits and normally answers with the full number, which is unique on its own;
 * but it sometimes echoes back nothing more than the six it was given, and six
 * digits are not an identifier — two customers paying the same shop a week
 * apart can genuinely share them. Pairing the tail with the date is the
 * narrowest thing that is still true: within one day, on one affiliation, a
 * six-digit tail is the payment.
 *
 * `askedDigits` is the bank's own `referenceDigits`. A reference no longer than
 * what we asked with is a tail; anything longer is the bank telling us more
 * than we knew, and stands alone.
 */
export function paymentKey({
  reference,
  occurredOn,
  askedDigits,
}: {
  /** As the bank reported it. Never the cashier's typing. */
  readonly reference: string;
  /** `YYYY-MM-DD`, Venezuela local, of the movement itself. */
  readonly occurredOn: string;
  readonly askedDigits: number;
}): string {
  const canonical = canonicalReference(reference);
  // Counted on the reference as it arrived, not on the canonical form: leading
  // zeros are padding the bank chose, and stripping them first would read
  // '000150' as three digits and call a full reference a tail.
  const digits = reference.replace(/\D/g, '').length;
  return digits > askedDigits ? canonical : `${canonical}@${occurredOn}`;
}
