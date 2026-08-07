/**
 * Banesco's `statusCode` → what Cuadre does about it.
 *
 * The bank mixes HTTP-looking numbers ('204', '503'), its own numeric codes
 * ('70001') and its own alphanumeric ones ('VRN04') in the same field, and
 * sends them sometimes as numbers and sometimes as strings. Everything is
 * compared as an upper-cased string so the table is one flat list.
 *
 * Two codes are deliberately not failures:
 *   70001 — no results. "The bank does not report this payment yet" is an
 *           answer; it is what sends `findPayment` to its fallback and, if that
 *           finds nothing either, what the counter reads as *todavía no
 *           aparece*. Turning it into an error would tell a cashier a payment
 *           was rejected when nothing was rejected.
 *   70005 — the date range must be split. Our problem to solve, never the
 *           user's to see.
 */
import type { BankFailure } from '../../../application/ports/bank-gateway.ts';

/** Numbers on some services, strings on others. Normalised before any compare. */
export type BanescoStatusCode = string | number;

export const BANESCO_OK = '200';
export const BANESCO_NO_RESULTS = '70001';
export const BANESCO_SPLIT_RANGE = '70005';

export type BanescoStatus =
  | { readonly kind: 'ok' }
  | { readonly kind: 'no_results' }
  | { readonly kind: 'split_range' }
  | { readonly kind: 'failure'; readonly failure: BankFailure };

/**
 * The mapping, as the bank documents it. The parenthesised numbers are the HTTP
 * status that carries the code, kept as a comment because they are the only way
 * to recognise the same condition when the body is unreadable.
 */
const FAILURE_BY_STATUS: Readonly<Record<string, BankFailure | undefined>> = {
  '204': 'no_accounts',
  VDE01: 'invalid_input',
  VDE02: 'invalid_input',
  VRN01: 'rejected_credentials',
  VRN04: 'maintenance',
  VRN05: 'rate_limited', // 429
  VRN06: 'unavailable', // 424
  '409': 'unavailable',
  '422': 'unavailable',
  '500': 'unavailable',
  '503': 'unavailable',
  '504': 'timeout',
};

export function isNoResults(code: BanescoStatusCode): boolean {
  return normalise(code) === BANESCO_NO_RESULTS;
}

export function classifyStatus(code: BanescoStatusCode): BanescoStatus {
  const value = normalise(code);

  if (value === BANESCO_OK) return { kind: 'ok' };
  if (value === BANESCO_NO_RESULTS) return { kind: 'no_results' };
  if (value === BANESCO_SPLIT_RANGE) return { kind: 'split_range' };

  // An unrecognised code is still the bank declining to answer the question.
  // 'unavailable' is the honest default: it does not accuse the merchant's
  // credentials, and it is the one the UI already tells people to retry.
  return { kind: 'failure', failure: FAILURE_BY_STATUS[value] ?? 'unavailable' };
}

/**
 * The fallback for a reply with no readable `statusCode` — an HTML error page
 * from the gateway in front of the bank, or a 401 from Keycloak, which never
 * carries one.
 */
export function failureForHttpStatus(status: number): BankFailure {
  if (status === 400) return 'invalid_input';
  if (status === 401 || status === 403) return 'rejected_credentials';
  if (status === 429) return 'rate_limited';
  if (status === 504) return 'timeout';
  return 'unavailable';
}

function normalise(code: BanescoStatusCode): string {
  return String(code).trim().toUpperCase();
}
