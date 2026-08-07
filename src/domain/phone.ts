/**
 * The payer's mobile number.
 *
 * One canonical form, `584143125566`, because it is what the bank expects in
 * `FindPaymentQuery.payerPhone` and what `validations.payer_phone` stores. A
 * customer reads their number out as '0414-3125566' and a receipt prints it as
 * '+58 414 3125566'; both are the same payer, and storing them as two strings
 * would mean a reference lookup that matches on phone silently missing.
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

/** Country code plus the ten national digits. */
const CANONICAL_PHONE = /^58(\d{3})(\d{7})$/;

/**
 * `null` when it is not a Venezuelan mobile. Punctuation is discarded first,
 * so parentheses, spaces, hyphens and a leading '+' are all just noise around
 * the same ten national digits.
 */
export function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');

  const national = nationalDigits(digits);
  if (national === null) return null;
  if (!VENEZUELAN_MOBILE_PREFIXES.includes(`0${national.slice(0, 3)}`)) return null;

  return `${COUNTRY_CODE}${national}`;
}

/**
 * Back to what a Venezuelan reads aloud: '0414-3125566'.
 *
 * Shape only — a stored number is already known to be a valid mobile, and a
 * display helper that refuses to render is a blank cell on a receipt. Anything
 * that is not the canonical form comes back untouched rather than as an empty
 * string, so a surprise in the column is visible instead of hidden.
 */
export function formatPhoneForDisplay(normalised: string): string {
  const parsed = CANONICAL_PHONE.exec(normalised);
  if (parsed === null) return normalised;
  return `0${parsed[1]}-${parsed[2]}`;
}

/** The ten digits after any country or trunk prefix, or `null`. */
function nationalDigits(digits: string): string | null {
  if (digits.length === 12 && digits.startsWith(COUNTRY_CODE)) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  if (digits.length === 10) return digits;
  return null;
}
