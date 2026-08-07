/**
 * Money, as integer cents.
 *
 * Every amount in this system is an INTEGER of cents, from the bank's decimal
 * string all the way to `validations.amount_cents`. Nothing here multiplies a
 * float by 100: `parseAmountToCents` concatenates the digit characters and
 * reads the result once, so the number `1.005` is refused outright instead of
 * quietly becoming 100 cents because the double behind it is
 * 1.00499999999999989.
 *
 * The refusal is the point. An amount we cannot represent exactly is not an
 * amount we are willing to compare against an expected total.
 */

/**
 * The only currency Cuadre settles. Banesco answers `'BS '` — trailing space
 * included — which is why nothing compares against a raw currency field.
 */
export const CURRENCY_BOLIVAR = 'BS';

export function isSupportedCurrency(raw: string): boolean {
  return raw.trim().toUpperCase() === CURRENCY_BOLIVAR;
}

/** Whole digits, exactly two decimal digits, and the sign. Never a float. */
type Digits = { readonly negative: boolean; readonly integer: string; readonly fraction: string };

/**
 * Reads an amount into integer cents, or `null` when it is not an amount.
 *
 * Accepts what banks actually emit: a plain decimal string (`'1240.00'`), a
 * JSON number (`1240`), and Venezuelan grouping (`'1.240,00'`). Also accepts
 * US grouping (`'1,240.00'`), because deciding which separator is decimal from
 * its position is no harder than assuming one, and assuming wrong is a factor
 * of a thousand.
 *
 * A number and a string are **not** the same input. A JS number cannot carry a
 * grouping separator, so `1.005` is unambiguously one bolívar and half a cent
 * and is refused; the string `'1.005'` is a grouped thousand and five, exactly
 * as `'1.240'` is a thousand two hundred forty. Sending a number through the
 * locale-tolerant path is how a half-cent silently becomes a thousand.
 */
export function parseAmountToCents(input: string | number): number | null {
  const digits = typeof input === 'number' ? fromNumber(input) : fromText(input.trim());
  if (digits === null) return null;

  const cents = Number(`${digits.integer}${digits.fraction}`);
  if (!Number.isSafeInteger(cents)) return null;
  return digits.negative ? -cents : cents;
}

/** 'Bs 1.240,00' — dot groups the thousands, comma opens the cents. */
export function formatBolivares(cents: number): string {
  // Display never throws and never renders 'NaN' at a counter; a value that
  // is not an integer count of cents did not come from `amount_cents`.
  const safe = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const digits = String(Math.abs(safe)).padStart(3, '0');
  const sign = safe < 0 ? '-' : '';
  return `Bs ${sign}${groupThousands(digits.slice(0, -2))},${digits.slice(-2)}`;
}

/**
 * The digits a JS number prints as. There is no grouping to disambiguate here
 * and no locale in play — only the shortest decimal form the runtime chose.
 *
 * Exponential notation (`1e+21`, `1e-7`) is refused rather than expanded:
 * those magnitudes are not bolívar amounts, and expanding one would be
 * inventing digits the caller never had.
 */
function fromNumber(value: number): Digits | null {
  if (!Number.isFinite(value)) return null;
  const parsed = /^(-?)(\d+)\.?(\d*)$/.exec(String(value));
  if (parsed === null) return null;

  const fraction = toCentDigits(parsed[3]);
  return fraction === null ? null : { negative: parsed[1] === '-', integer: parsed[2], fraction };
}

/** The digits a human or a bank wrote, with whichever grouping they used. */
function fromText(text: string): Digits | null {
  const parsed = /^([+-]?)([\d.,]+)$/.exec(text);
  if (parsed === null) return null;

  const split = splitDecimal(parsed[2]);
  return split === null ? null : { negative: parsed[1] === '-', ...split };
}

/** Digits of the whole part, and exactly two digits of cents. */
function splitDecimal(body: string): { integer: string; fraction: string } | null {
  const at = decimalSeparatorIndex(body);
  if (at === -1) {
    const whole = ungroup(body);
    return whole === null ? null : { integer: whole, fraction: '00' };
  }

  const integer = ungroup(body.slice(0, at));
  const fraction = body.slice(at + 1);
  // A trailing separator ('1.') is a truncated string, not an amount.
  if (integer === null || !/^\d+$/.test(fraction)) return null;

  const cents = toCentDigits(fraction);
  return cents === null ? null : { integer, fraction: cents };
}

/**
 * Two decimal digits, or `null`. Beyond the second decimal there is nothing to
 * round to: a bank that means half a cent means a bug, and rounding it would
 * decide in someone's favour. Trailing zeros are not a third decimal, so
 * '0.100' is ten cents while '0.105' is refused.
 */
function toCentDigits(fraction: string): string | null {
  if (/[1-9]/.test(fraction.slice(2))) return null;
  return fraction.slice(0, 2).padEnd(2, '0');
}

/**
 * Index of the decimal separator, or -1 when the string carries none.
 *
 * With both separators present the rightmost one is the decimal by definition.
 * With only one, three digits behind it means grouping ('1.240' is one
 * thousand two hundred forty, the way it is written on a Venezuelan receipt)
 * — but only when what precedes it could be a leading group, which is why
 * '0.100' stays a decimal: no grouped number starts with a zero.
 */
function decimalSeparatorIndex(body: string): number {
  const dot = body.lastIndexOf('.');
  const comma = body.lastIndexOf(',');
  if (dot !== -1 && comma !== -1) return Math.max(dot, comma);

  const at = Math.max(dot, comma);
  if (at === -1) return -1;

  const separator = body[at];
  const isOnlyOne = body.indexOf(separator) === at;
  const head = body.slice(0, at);
  const tail = body.slice(at + 1);
  const groups = isOnlyOne && tail.length === 3 && /^[1-9]\d{0,2}$/.test(head);
  return groups || !isOnlyOne ? -1 : at;
}

/**
 * Strips grouping separators, refusing anything that is not a grouped number:
 * one to three digits, then groups of exactly three. '1,240,00' is not a
 * number in any locale and must not read as 124000.
 */
function ungroup(part: string): string | null {
  if (/^\d+$/.test(part)) return part;
  // The backreference is load-bearing: it forbids '1.240,500', which is not a
  // number in any locale and would otherwise read as a number a thousand times
  // too large.
  const grouped = /^[1-9]\d{0,2}(?:([.,])\d{3})(?:\1\d{3})*$/.exec(part);
  if (grouped === null) return null;
  return part.split(grouped[1]).join('');
}

function groupThousands(digits: string): string {
  let out = '';
  for (let i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits[i];
  }
  return out;
}
