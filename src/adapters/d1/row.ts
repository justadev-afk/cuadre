/**
 * Reading one column out of a D1 row, and refusing to guess.
 *
 * A row arrives as `Record<string, unknown>`: D1's generic parameter is an
 * assertion, not a check, so a schema drift would flow straight into a domain
 * object and only surface as a comparison that quietly does the wrong thing.
 * These accessors are the parse at that boundary. A zod object per row would
 * say the same thing, and would say it on the checkout path for every column
 * of every read — four field reads are cheaper and fail just as loudly.
 *
 * The thrown detail names the column and never carries its value: these rows
 * hold payment references, phone numbers and sealed credentials, and the detail
 * reaches the logs.
 */
import { AppError } from '../../shared/errors.ts';

export type D1Row = Record<string, unknown>;

function wrong(column: string, expected: string): AppError {
  return new AppError('internal', `column "${column}" is not ${expected}`);
}

export function text(row: D1Row, column: string): string {
  const value = row[column];
  if (typeof value !== 'string') throw wrong(column, 'text');
  return value;
}

export function optionalText(row: D1Row, column: string): string | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw wrong(column, 'text or null');
  return value;
}

/**
 * SQLite has one numeric type per value, so an INTEGER column can come back as
 * a JS float once it passes 2^53. Every integer we store is an epoch second, a
 * count or a cent amount — all comfortably inside the safe range — so a value
 * outside it is corruption, not a large number.
 */
export function integer(row: D1Row, column: string): number {
  const value = row[column];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw wrong(column, 'an integer');
  }
  return value;
}

export function optionalInteger(row: D1Row, column: string): number | null {
  const value = row[column];
  if (value === null || value === undefined) return null;
  return integer(row, column);
}

/** An INTEGER column constrained to 0/1. Anything else is corruption. */
export function flag(row: D1Row, column: string): boolean {
  const value = integer(row, column);
  if (value !== 0 && value !== 1) throw wrong(column, '0 or 1');
  return value === 1;
}

/**
 * A BLOB column. D1 has returned bytes as `ArrayBuffer` and, in older
 * revisions, as a plain array of byte values; both are accepted because a
 * repository that assumes one of them breaks on a runtime bump, and the thing
 * it breaks is a company's ability to decrypt its own bank credentials.
 */
export function bytes(row: D1Row, column: string): Uint8Array {
  const value = row[column];
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value, (byte) => {
      if (typeof byte !== 'number') throw wrong(column, 'bytes');
      return byte;
    });
  }
  throw wrong(column, 'bytes');
}
