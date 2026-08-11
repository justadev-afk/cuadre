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
  if (digits === '') return '';

  // A Venezuelan pago-móvil number always begins 04. Strip an optional leading
  // 0 and 4 the caller may have typed, then re-impose the trunk, so the field
  // can only ever hold `04XX-XXXXXXX` — the shape `normalisePhone` accepts.
  const line = digits.replace(/^0?4?/, '').slice(0, 9);
  const full = `04${line}`;
  return full.length <= 4 ? full : `${full.slice(0, 4)}-${full.slice(4)}`;
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

/**
 * '0134 0000 0000 0000 0000' — a 20-digit bank account in groups of four, the
 * way the placeholder shows it. Purely cosmetic: `connect-bank-account` strips
 * every non-digit before it judges or seals the number, so the spaces never
 * reach the bank.
 */
export function maskAccountNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 20);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/**
 * '10/07/2026' — the date a Venezuelan writes, day first.
 *
 * Cosmetic only, and it never invents a digit: typing `1` shows `1`, not `01`.
 * The slashes appear as the groups fill, so a half-typed date reads as one
 * growing number rather than flickering separators. `readTypedDate` is the
 * authority on what it means.
 */
export function maskDate(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * A typed `DD/MM/YYYY` (or `DD/MM`, meaning this year) → the `YYYY-MM-DD` the
 * bank is asked with. `null` when it is not a day that exists, or is in the
 * future — a payment cannot have happened tomorrow.
 *
 * The round trip through `Date` is what rejects the 31st of February: reading
 * the parts back catches a day the calendar rolled over, which a range check on
 * `1..31` would let through. `today` is a parameter so the rule is testable
 * without a clock, and so it is read fresh at the call site (a till open
 * overnight must not keep yesterday's idea of the future).
 */
export function readTypedDate(typed: string, today: string): string | null {
  const parts = typed.split('/');
  if (parts.length < 2 || parts.length > 3) return null;

  const [day, month, year = String(new Date(`${today}T00:00:00Z`).getUTCFullYear())] = parts;
  if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;

  const at = new Date(Number(year), Number(month) - 1, Number(day));
  // A date the calendar rolled over — 31/02 becomes 03/03 — is not the date
  // that was typed, and silently asking the bank about another day is worse
  // than refusing.
  if (at.getMonth() !== Number(month) - 1 || at.getDate() !== Number(day)) return null;

  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return iso > today ? null : iso;
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
