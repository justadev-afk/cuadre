/**
 * The payer's mobile number.
 *
 * One canonical form, and it is **E.164**: `+584143125566`. A customer reads
 * their number out as '0414-3125566' and a receipt may arrive with '+58 414
 * 3125566' on it; both are the same payer, and storing them as two strings
 * would mean a lookup that matches on phone silently missing.
 *
 * Stored that way and *shown* the other: `formatPhoneForDisplay` puts the trunk
 * zero back, because that is how a number is read aloud, written on a receipt
 * and saved in a phone here. The two are the same fact in two audiences' words —
 * the plus is what makes a stored number unambiguous to anything that reads the
 * column, and the zero is what makes it recognisable to the person holding the
 * receipt. What a *bank* wants on the wire is a third audience, and that is that
 * bank's own business: Banesco takes the bare digits, and its client strips the
 * plus on the way out (§4).
 */

/**
 * The operator prefixes that carry pago móvil. A landline (0212, 0241, …) has
 * no mobile-payment wallet behind it, so accepting one would only produce a
 * lookup the bank can never answer.
 */
export const VENEZUELAN_MOBILE_PREFIXES: readonly string[] = [
  '0412',
  '0414',
  '0416',
  '0424',
  '0426',
];

const COUNTRY_CODE = '58';

/** The canonical form, split into the operator and the line. */
const CANONICAL_PHONE = /^\+58(\d{3})(\d{7})$/;

/**
 * `null` when it is not a Venezuelan mobile. Punctuation is discarded first, so
 * parentheses, spaces, hyphens and a leading '+' are all just noise around the
 * same ten national digits — which is also why this is what repairs a number
 * stored before the plus was canonical.
 */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  const national = nationalDigits(digits);
  if (national === null) return null;
  if (!VENEZUELAN_MOBILE_PREFIXES.includes(`0${national.slice(0, 3)}`)) return null;

  return `+${COUNTRY_CODE}${national}`;
}

/**
 * The number as every screen shows it: '0414-3125566'.
 *
 * Storage is E.164 and reading is not: nobody in Venezuela says "más cincuenta
 * y ocho". A number is read aloud, written on a receipt and saved in a phone
 * with its trunk zero, so that is the one shape on screen — the table, the
 * modal, the tooltip and the printed ticket. The panel used to show two at once
 * (the column printed the stored string raw, the modal spelled it out), and a
 * merchant comparing a row against a customer's screen should not have to
 * translate between them.
 *
 * It normalises first, so it renders the same whichever spelling it is handed —
 * a row stored before 0009 and one stored after read identically. Anything it
 * cannot read comes back untouched rather than as an empty string: a display
 * helper that refuses to render is a blank cell on a receipt, and a surprise in
 * the column is better seen than hidden.
 */
export function formatPhoneForDisplay(stored: string): string {
  const parsed = CANONICAL_PHONE.exec(normalisePhone(stored) ?? '');
  if (parsed === null) return stored;
  return `0${parsed[1]}-${parsed[2]}`;
}

/** The ten digits after any country or trunk prefix, or `null`. */
function nationalDigits(digits: string): string | null {
  if (digits.length === 12 && digits.startsWith(COUNTRY_CODE)) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}
