/**
 * The six digits a cashier writes on the receipt.
 *
 * Not a secret and not an identifier: `validations.id` identifies the row. This
 * is a short handle so a customer can phone in about one payment without
 * reading eleven digits of reference back, which is why it is digits only and
 * why six of them is enough.
 */
import type { IdGen } from '../shared/id.ts';

export const CONTROL_CODE_LENGTH = 6;

/**
 * Uniqueness is not this function's job. It draws digits; the caller writes
 * them and lets the database decide.
 */
export function generateControlCode(ids: IdGen): string {
  return ids.digits(CONTROL_CODE_LENGTH);
}

/**
 * How many times the caller re-draws after a collision.
 *
 * The real serialisation point is the D1 UNIQUE index
 * `(company_id, control_code)` in `migrations/0001_init.sql` — not a SELECT
 * before the INSERT, which two cashiers on the same second would both pass.
 * A constraint violation on that index therefore means "this code is taken,
 * draw another", never "this payment failed".
 *
 * Three is generous rather than tuned: with a million codes per company, the
 * chance of three consecutive collisions is negligible until a company holds a
 * substantial share of the space, at which point retrying harder would be
 * hiding the real problem — the code is too short for that company — instead
 * of surfacing it.
 */
export const CONTROL_CODE_MAX_ATTEMPTS = 3;
