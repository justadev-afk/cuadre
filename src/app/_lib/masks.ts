/**
 * Cosmetic input masks for the fields a Venezuelan types by heart: the RIF and
 * the mobile number.
 *
 * These format *as you type* and nothing else. The domain is still the
 * authority: `normaliseRif` and `normalisePhone` both strip every non-digit
 * before judging the value, so a masked '`J-40123456-7`' and a raw
 * '`J401234567`' reach the server as the same thing. A mask that the server
 * could not un-format would be a mask that changes meaning, which is why these
 * only insert separators the normaliser is guaranteed to discard.
 */

/**
 * 'J-40123456-7'. Letter, then the body, then the check digit.
 *
 * The second hyphen only appears once there is a check digit to sit after it
 * (a body of nine digits or more), so a half-typed RIF reads as one growing
 * group rather than flickering a stray dash. Bodies of eight or nine both fall
 * out of the same rule — SENIAT issues both — and `normaliseRif` accepts either.
 */
export function maskRif(raw: string): string {
  const compact = raw.toUpperCase().replace(/[^JGVEP0-9]/g, '');
  if (compact === '') return '';

  const letter = /[JGVEP]/.test(compact[0]) ? compact[0] : '';
  const digits = (letter === '' ? compact : compact.slice(1)).replace(/\D/g, '').slice(0, 10);
  if (digits.length === 0) return letter;

  const lead = letter === '' ? '' : `${letter}-`;
  if (digits.length <= 8) return `${lead}${digits}`;

  return `${lead}${digits.slice(0, -1)}-${digits.slice(-1)}`;
}

/**
 * '0414-3125566'. Trunk-prefixed group of four, a hyphen, then the line.
 *
 * A pasted '+58 414…' or '58414…' is folded back to the '0414…' trunk form the
 * customer reads aloud, so the field shows one shape no matter how the number
 * arrived. Capped at the eleven national digits; `normalisePhone` does the rest.
 */
export function maskPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('58')) digits = `0${digits.slice(2)}`;
  digits = digits.slice(0, 11);

  if (digits.length <= 4) return digits;
  return `${digits.slice(0, 4)}-${digits.slice(4)}`;
}

/**
 * '1.240,00' — an amount that is always exactly two decimals, entered the way a
 * calculator or a POS terminal takes it: every digit is a cent, filling from
 * the right. Typing `3` `0` `2` `1` `5` reads `3,02` → `30,21` → `302,15`, so
 * the decimal point is never a keystroke and the field can never hold `1.005`
 * or `12,` — the two states `parseAmountToCents` refuses. Matches the reference
 * `CurrencyInput` (react-native-currency-input, precision 2, `.`/`,`).
 *
 * The result parses straight back: `parseAmountToCents('1.240,00')` is 124000.
 */
export function maskCurrency(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits === '') return '';

  // Cents, leading zeros stripped but padded to at least three so there is a
  // whole part and two decimals ('5' → '005' → '0,05').
  const cents = String(Number(digits)).padStart(3, '0');
  const whole = cents.slice(0, -2);
  const fraction = cents.slice(-2);
  return `${groupThousands(whole)},${fraction}`;
}

/** '1240' → '1.240'. Dots every three digits from the right. */
export function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits[i];
  }
  return out;
}
