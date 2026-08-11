/**
 * Banesco's wire encodings → the units the port promises.
 *
 * The bank sends money as a decimal (19,2), instants as a Venezuela local date
 * plus a local time in two fields, and account numbers already masked. The port
 * promises integer cents, epoch seconds and a value that is safe to render.
 * Every conversion is here so it is written once: doing it twice is how a float
 * eventually reaches a comparison that approves a payment.
 *
 * Every function returns `null` rather than a wrong answer. A caller that
 * cannot map a field must fail the whole reply, not carry a zero forward.
 */
import { VENEZUELA_UTC_OFFSET_MINUTES } from '../../../shared/clock.ts';

/** `1240`, `1240.5`, `1240.55` — plus or minus, nothing else. */
const DECIMAL = /^-?\d+(?:\.\d{1,2})?$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TWO_DIGITS = /^\d{1,2}$/;
const NON_DIGITS = /\D/g;

const SECONDS_PER_MINUTE = 60;

export function decimalToCents(value: string | number): number | null {
  // Parsed by hand rather than with `Number(x) * 100`: that product is
  // 124009.99999999999 for '1240.10', and a cent lost here is a payment
  // approved for an amount the customer did not send.
  const text = typeof value === 'number' ? value.toFixed(2) : value.trim();
  if (!DECIMAL.test(text)) return null;

  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  // A decimal(19,2) can hold more digits than a JS integer can carry exactly.
  // No real bolívar balance is that large, so this is a corrupt field.
  if (!Number.isSafeInteger(cents)) return null;
  return negative ? -cents : cents;
}

/**
 * The bank masks the account itself in a transaction reply
 * ('1340************8514'), but not everywhere, and the port's guarantee is
 * that a full number never leaves an adapter. Anything still readable is masked
 * here rather than trusted to be masked upstream.
 */
export function maskAccountNumber(accountId: string): string {
  const value = accountId.trim();
  if (value.includes('*')) return value;
  if (value.length <= 4) return '****';
  if (value.length <= 8) return `****${value.slice(-4)}`;
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
}

/** The last four digits of a masked or full account — the only part we compare. */
export function lastFour(accountId: string): string {
  return accountId.replace(NON_DIGITS, '').slice(-4);
}

/** Sudeban codes are four digits; the bank drops the leading zero often enough. */
export function padSudebanId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(NON_DIGITS, '');
  return digits === '' ? null : digits.padStart(4, '0');
}

/**
 * `trnDate` + `trnTime` are Venezuela local (UTC−4, no DST) → epoch seconds.
 *
 * Only `YYYY-MM-DD` for the date: a tolerant parser would have to guess at
 * `01/02/2026`, and guessing wrong dates a payment a day out — which is exactly
 * the field the search matches on.
 *
 * The *time* accepts `:` or `.` between its parts. The manual documents
 * `HH:MM:SS` and the confirmation service does send that, but QA's pago-móvil
 * rows come back as `00.00.00` — and refusing them meant refusing the whole
 * reply, which the counter then reported as "el banco no pudo responder" for a
 * payment the bank had just handed us. The separator is punctuation; the three
 * numbers are the fact, and they are still validated one by one below.
 */
export function venezuelaLocalToEpochSeconds(date: string, time: string): number | null {
  const day = ISO_DATE.exec(date.trim());
  if (!day) return null;

  const parts = time.trim().split(/[:.]/);
  if (parts.length < 2 || parts.length > 3) return null;
  const [hours, minutes, seconds = '0'] = parts;
  if (!TWO_DIGITS.test(hours) || !TWO_DIGITS.test(minutes) || !TWO_DIGITS.test(seconds))
    return null;

  const [year, month, dayOfMonth] = [Number(day[1]), Number(day[2]), Number(day[3])];
  const [hour, minute, second] = [Number(hours), Number(minutes), Number(seconds)];
  if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return null;
  if (hour > 23 || minute > 59 || second > 59) return null;

  const asIfUtc = Date.UTC(year, month - 1, dayOfMonth, hour, minute, second);
  if (Number.isNaN(asIfUtc)) return null;

  // `Date.UTC` read those fields as if they were UTC. They are local, so the
  // offset comes back out: 10:00 in Caracas is 14:00 UTC.
  return Math.floor(asIfUtc / 1000) - VENEZUELA_UTC_OFFSET_MINUTES * SECONDS_PER_MINUTE;
}
