/**
 * The payer's mobile number.
 *
 * One canonical form, and it is **E.164**: `+584143125566`. A customer reads
 * their number out as '0414-3125566' and a receipt may arrive with '+58 414
 * 3125566' on it; both are the same payer, and storing them as two strings
 * would mean a lookup that matches on phone silently missing.
 *
 * The `+` is part of the format, not decoration. It is what says the digits
 * after it are a country code rather than a trunk prefix — `584143125566` and
 * `0584143125566` are not distinguishable by shape alone — and it is what makes
 * a stored number recognisable as a phone number anywhere it is read: a column
 * in the panel, a CSV a merchant exports, a row somebody eyeballs in the D1
 * console. What a *bank* wants on the wire is that bank's own business: Banesco
 * takes the bare digits, and its client strips the plus on the way out (§4).
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
 * The number as every screen shows it: '+584143125566'.
 *
 * One shape, everywhere — the table, the modal, the tooltip and the printed
 * ticket. The panel used to show three at once (the column printed the stored
 * string raw, the modal rendered '0414-…', the receipt a third thing), and a
 * merchant comparing a row against a customer's screen should not have to
 * translate between them.
 *
 * Anything this cannot read comes back untouched rather than as an empty
 * string: a display helper that refuses to render is a blank cell on a receipt,
 * and a surprise in the column is better seen than hidden.
 */
export function formatPhoneForDisplay(stored: string): string {
  return normalisePhone(stored) ?? stored;
}

/** The ten digits after any country or trunk prefix, or `null`. */
function nationalDigits(digits: string): string | null {
  if (digits.length === 12 && digits.startsWith(COUNTRY_CODE)) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}
