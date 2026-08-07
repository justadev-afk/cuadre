/**
 * The keyset cursor for a validation list.
 *
 * The page is ordered by `(created_at DESC, id DESC)` and the cursor is the
 * last row of the previous page, so the next page is a range scan on
 * `ix_validations_company` rather than an OFFSET that re-walks everything
 * before it. `created_at` alone is not unique — two cashiers can confirm in the
 * same second — so `id` is carried as the tie-break, and dropping it would skip
 * or repeat rows exactly when the counter is busiest.
 *
 * The wire form is opaque to the client on purpose: it is a position, not an
 * API, and encoding it here keeps the shape next to the ORDER BY it has to
 * agree with.
 */

export type ValidationCursor = {
  readonly createdAt: number;
  readonly id: string;
};

const SEPARATOR = '.';

/** `<created_at>.<id>`. Ids are uuids, which contain no separator. */
export function encodeValidationCursor(cursor: ValidationCursor): string {
  return `${cursor.createdAt}${SEPARATOR}${cursor.id}`;
}

/**
 * `null` for anything malformed. A cursor is client-supplied, and a bad one
 * must not silently become "start from the beginning" — that would quietly hand
 * back page one forever. The caller turns `null` into `invalid_request`.
 */
export function decodeValidationCursor(value: string): ValidationCursor | null {
  const at = value.indexOf(SEPARATOR);
  if (at <= 0) return null;

  const createdAt = Number(value.slice(0, at));
  const id = value.slice(at + 1);
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || id.length === 0) return null;
  // A second separator means the string was not produced by `encode`. Accepting
  // it would make the encoding non-injective, and a cursor that decodes to a
  // position nobody wrote is a page boundary nobody can reproduce in a bug
  // report.
  if (id.includes(SEPARATOR)) return null;

  return { createdAt, id };
}
