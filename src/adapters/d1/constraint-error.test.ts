import { describe, expect, it } from 'vitest';

import { isUniqueIndex, readConstraintFailure, type UniqueIndex } from './constraint-error.ts';

const PAYMENT: UniqueIndex = {
  name: 'ux_validations_payment',
  columns: ['validations.bank_account_id', 'validations.reference'],
};
const IDEMPOTENCY: UniqueIndex = {
  name: 'ux_validations_idempotency',
  columns: ['validations.idempotency_key'],
};

describe('readConstraintFailure', () => {
  it('reads the column list SQLite reports for an ordinary unique index', () => {
    const failure = readConstraintFailure(
      new Error(
        'D1_ERROR: UNIQUE constraint failed: validations.bank_account_id, ' +
          'validations.reference: SQLITE_CONSTRAINT',
      ),
    );

    expect(failure).toEqual({
      kind: 'unique',
      index: null,
      columns: ['validations.bank_account_id', 'validations.reference'],
    });
  });

  it('reads the index name for the expression-index form', () => {
    const failure = readConstraintFailure(
      new Error("D1_ERROR: UNIQUE constraint failed: index 'ux_validations_payment'"),
    );

    expect(failure).toEqual({ kind: 'unique', index: 'ux_validations_payment', columns: [] });
  });

  it('reads the message off the cause when D1 wraps it there', () => {
    const wrapped = new Error('D1_ERROR: statement failed', {
      cause: new Error('UNIQUE constraint failed: validations.idempotency_key'),
    });

    expect(readConstraintFailure(wrapped)).toEqual({
      kind: 'unique',
      index: null,
      columns: ['validations.idempotency_key'],
    });
  });

  it('tells the other three constraint kinds apart', () => {
    expect(readConstraintFailure(new Error('FOREIGN KEY constraint failed'))).toEqual({
      kind: 'foreign_key',
    });
    expect(readConstraintFailure(new Error('CHECK constraint failed: users'))).toEqual({
      kind: 'check',
    });
    expect(readConstraintFailure(new Error('NOT NULL constraint failed: users.name'))).toEqual({
      kind: 'not_null',
      column: 'users.name',
    });
  });

  it('returns null for anything that is not a constraint violation', () => {
    expect(readConstraintFailure(new Error('D1_ERROR: network'))).toBeNull();
    expect(readConstraintFailure('not an error at all')).toBeNull();
    expect(readConstraintFailure(undefined)).toBeNull();
  });
});

describe('isUniqueIndex', () => {
  it('matches on the column list', () => {
    const failure = readConstraintFailure(
      new Error('UNIQUE constraint failed: validations.bank_account_id, validations.reference'),
    );
    if (failure === null) throw new Error('expected a constraint failure');

    expect(isUniqueIndex(failure, PAYMENT)).toBe(true);
    expect(isUniqueIndex(failure, IDEMPOTENCY)).toBe(false);
  });

  it('matches on the index name when that is the form given', () => {
    const failure = readConstraintFailure(
      new Error("UNIQUE constraint failed: index 'ux_validations_idempotency'"),
    );
    if (failure === null) throw new Error('expected a constraint failure');

    expect(isUniqueIndex(failure, IDEMPOTENCY)).toBe(true);
    expect(isUniqueIndex(failure, PAYMENT)).toBe(false);
  });

  it('does not match a prefix of the index columns', () => {
    const failure = readConstraintFailure(
      new Error('UNIQUE constraint failed: validations.bank_account_id'),
    );
    if (failure === null) throw new Error('expected a constraint failure');

    expect(isUniqueIndex(failure, PAYMENT)).toBe(false);
  });

  it('never matches a non-unique failure', () => {
    const failure = readConstraintFailure(new Error('FOREIGN KEY constraint failed'));
    if (failure === null) throw new Error('expected a constraint failure');

    expect(isUniqueIndex(failure, PAYMENT)).toBe(false);
  });
});
