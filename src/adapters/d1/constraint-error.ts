/**
 * Turning a rejected write back into a decision the caller can act on.
 *
 * D1 reports a constraint violation as a thrown `Error` and nothing else — no
 * code, no field naming the index. Matching on the message string is
 * unpleasant, and it is the price of letting the database arbitrate the race:
 * a SELECT-then-INSERT would read "no such payment yet" in both of two
 * concurrent requests and charge the customer twice. The index is the
 * mechanism; this file is how its verdict gets read.
 *
 * SQLite names the *columns*, not the index, for an ordinary unique index —
 * `UNIQUE constraint failed: validations.company_id, validations.control_code`
 * — and only falls back to `index '<name>'` when the index is over an
 * expression. Both forms are parsed, so a call site can declare an index once,
 * by name *and* by columns, and stay correct whichever form the runtime emits.
 *
 * An unnamed CHECK is reported inconsistently across SQLite versions (the table
 * name in some, the expression text in others), so `check` carries nothing:
 * which CHECK failed is inferred from what the statement was allowed to do, not
 * from the string.
 */

export type UniqueIndex = {
  readonly name: string;
  /** `table.column`, lowercase, in the order the index declares them. */
  readonly columns: readonly string[];
};

export type ConstraintFailure =
  | { readonly kind: 'unique'; readonly index: string | null; readonly columns: readonly string[] }
  | { readonly kind: 'not_null'; readonly column: string | null }
  | { readonly kind: 'foreign_key' }
  | { readonly kind: 'check' };

const UNIQUE_FAILED = /UNIQUE constraint failed:\s*([^:]+)/i;
const NOT_NULL_FAILED = /NOT NULL constraint failed:\s*([^:]+)/i;
const FOREIGN_KEY_FAILED = /FOREIGN KEY constraint failed/i;
const CHECK_FAILED = /CHECK constraint failed/i;
const NAMED_INDEX = /^index\s+'([^']+)'$/i;

/** `null` when the error is not a constraint violation — those must be rethrown. */
export function readConstraintFailure(error: unknown): ConstraintFailure | null {
  const message = messageOf(error);

  const unique = firstGroup(UNIQUE_FAILED, message);
  if (unique !== null) return readUnique(unique);

  const notNull = firstGroup(NOT_NULL_FAILED, message);
  if (notNull !== null) return { kind: 'not_null', column: notNull };

  if (FOREIGN_KEY_FAILED.test(message)) return { kind: 'foreign_key' };
  if (CHECK_FAILED.test(message)) return { kind: 'check' };

  return null;
}

/** True when this failure is that index, identified by its name or its columns. */
export function isUniqueIndex(failure: ConstraintFailure, index: UniqueIndex): boolean {
  if (failure.kind !== 'unique') return false;
  if (failure.index !== null) return failure.index === index.name;
  if (failure.columns.length !== index.columns.length) return false;
  return index.columns.every((column, i) => failure.columns[i] === column.toLowerCase());
}

function readUnique(target: string): ConstraintFailure {
  const named = firstGroup(NAMED_INDEX, target);
  if (named !== null) return { kind: 'unique', index: named, columns: [] };

  const columns = target
    .split(',')
    .map((column) => column.trim().toLowerCase())
    .filter((column) => column.length > 0);

  return { kind: 'unique', index: null, columns };
}

/** `null` when the pattern did not match. The annotation is what keeps the
 * absent-group case a real branch rather than an unchecked index read. */
function firstGroup(pattern: RegExp, value: string): string | null {
  const match = pattern.exec(value);
  const group: string | undefined = match?.[1];
  return group === undefined ? null : group.trim();
}

/**
 * D1 wraps the SQLite error, and which of the two carries the text has moved
 * between releases. Reading both means a runtime bump cannot silently turn a
 * duplicate-payment verdict into a 500.
 */
function messageOf(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  return cause instanceof Error ? `${error.message} ${cause.message}` : error.message;
}
