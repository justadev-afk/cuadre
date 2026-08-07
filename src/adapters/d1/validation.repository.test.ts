import { describe, expect, it } from 'vitest';

import { AppError } from '../../shared/errors.ts';
import { makeFakeD1, uniqueViolation } from './d1.fake.ts';
import { D1ValidationRepository, toValidation } from './validation.repository.ts';
import { decodeValidationCursor, encodeValidationCursor } from './validation-cursor.ts';

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'val-1',
    company_id: 'la-espiga',
    cashier_id: 'user-1',
    bank_account_id: 'acct-1',
    bank: 'banesco',
    is_sandbox: 0,
    control_code: '481920',
    reference: '00012345678',
    amount_cents: 124_000,
    currency: 'BS',
    payer_phone: '584143125566',
    source_bank_id: '0134',
    trn_at: 1_770_000_000,
    latency_ms: 812,
    search_mode: 'exact_reference',
    idempotency_key: 'idem-1',
    created_at: 1_770_000_060,
    ...overrides,
  };
}

const NEW_VALIDATION = toValidation(row());

/** The `AppError.detail` a mapping failure carries, for asserting on the column. */
function detailOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error.detail ?? '';
    throw error;
  }
  throw new Error('expected the mapping to refuse the row');
}

describe('toValidation', () => {
  it('maps a row to the domain shape', () => {
    expect(toValidation(row())).toEqual({
      id: 'val-1',
      companyId: 'la-espiga',
      cashierId: 'user-1',
      bankAccountId: 'acct-1',
      bank: 'banesco',
      isSandbox: false,
      controlCode: '481920',
      reference: '00012345678',
      amountCents: 124_000,
      currency: 'BS',
      payerPhone: '584143125566',
      sourceBankId: '0134',
      trnAt: 1_770_000_000,
      latencyMs: 812,
      searchMode: 'exact_reference',
      idempotencyKey: 'idem-1',
      createdAt: 1_770_000_060,
    });
  });

  it('reads is_sandbox as a boolean and leaves the amount in cents', () => {
    const sandbox = toValidation(row({ is_sandbox: 1, amount_cents: 1 }));
    expect(sandbox.isSandbox).toBe(true);
    expect(sandbox.amountCents).toBe(1);
  });

  it('keeps the nullable columns nullable', () => {
    const sparse = toValidation(row({ latency_ms: null, search_mode: null }));
    expect(sparse.latencyMs).toBeNull();
    expect(sparse.searchMode).toBeNull();
  });

  it('reads an unknown search_mode as null rather than guessing one of the two', () => {
    expect(toValidation(row({ search_mode: 'psychic' })).searchMode).toBeNull();
  });

  it('refuses a row whose types do not match the schema', () => {
    // The column name is on `detail`, never on the message: the message is what
    // a user reads, and `errors.ts` keeps it in Spanish and free of internals.
    expect(() => toValidation(row({ amount_cents: '124000' }))).toThrow(AppError);
    expect(detailOf(() => toValidation(row({ amount_cents: '124000' })))).toContain('amount_cents');
    expect(detailOf(() => toValidation(row({ is_sandbox: 2 })))).toContain('is_sandbox');
    expect(detailOf(() => toValidation(row({ reference: null })))).toContain('reference');
  });
});

describe('insert', () => {
  it('returns the stored validation when the row lands', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row()] });

    const result = await new D1ValidationRepository(fake.db).insert(NEW_VALIDATION);

    expect(result).toEqual({ outcome: 'inserted', validation: NEW_VALIDATION });
  });

  it('binds is_sandbox as 0/1, never as a boolean', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row({ is_sandbox: 1 })] });

    await new D1ValidationRepository(fake.db).insert({ ...NEW_VALIDATION, isSandbox: true });

    expect(fake.calls[0]?.args).toContain(1);
    expect(fake.calls[0]?.args).not.toContain(true);
  });

  it('reads ux_validations_payment as a double charge', async () => {
    const fake = makeFakeD1();
    fake.reply(
      { throws: uniqueViolation('validations.bank_account_id', 'validations.reference') },
      // The follow-up lookup: no row with this idempotency key, so it really is
      // a different POST for a payment already taken.
      { rows: [] },
    );

    const result = await new D1ValidationRepository(fake.db).insert(NEW_VALIDATION);

    expect(result).toEqual({ outcome: 'duplicate_payment' });
  });

  it('reads ux_validations_control as a control-code collision', async () => {
    const fake = makeFakeD1();
    fake.reply({ throws: uniqueViolation('validations.company_id', 'validations.control_code') });

    const result = await new D1ValidationRepository(fake.db).insert(NEW_VALIDATION);

    expect(result).toEqual({ outcome: 'control_code_taken' });
  });

  it('reads ux_validations_idempotency as a replay', async () => {
    const fake = makeFakeD1();
    fake.reply({ throws: uniqueViolation('validations.idempotency_key') });

    const result = await new D1ValidationRepository(fake.db).insert(NEW_VALIDATION);

    expect(result).toEqual({ outcome: 'idempotent_replay' });
  });

  it('calls a retry a replay even when SQLite blames the payment index', async () => {
    // A retried POST violates both indexes and SQLite names only one. Trusting
    // the name here would answer "already charged" to the caller whose whole
    // reason for sending an idempotency key was to be told otherwise.
    const fake = makeFakeD1();
    fake.reply(
      { throws: uniqueViolation('validations.bank_account_id', 'validations.reference') },
      { rows: [row()] },
    );

    const result = await new D1ValidationRepository(fake.db).insert(NEW_VALIDATION);

    expect(result).toEqual({ outcome: 'idempotent_replay' });
  });

  it('rethrows anything that is not one of the three indexes', async () => {
    const fake = makeFakeD1();
    fake.reply({ throws: new Error('D1_ERROR: no such table: validations') });

    await expect(new D1ValidationRepository(fake.db).insert(NEW_VALIDATION)).rejects.toThrow(
      /no such table/,
    );
  });

  it('rethrows a unique failure on an index this file does not know', async () => {
    const fake = makeFakeD1();
    fake.reply({ throws: uniqueViolation('validations.some_future_column') });

    await expect(new D1ValidationRepository(fake.db).insert(NEW_VALIDATION)).rejects.toThrow(
      /UNIQUE constraint/,
    );
  });
});

describe('listByCompany', () => {
  it('asks for one row past the page and reports a cursor when it comes back', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row({ id: 'a' }), row({ id: 'b' })] });

    const page = await new D1ValidationRepository(fake.db).listByCompany({
      companyId: 'la-espiga',
      from: 1,
      to: 2,
      limit: 1,
    });

    expect(fake.calls[0]?.args.at(-1)).toBe(2);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toEqual({ createdAt: 1_770_000_060, id: 'a' });
  });

  it('reports no cursor on the last page', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row()] });

    const page = await new D1ValidationRepository(fake.db).listByCompany({
      companyId: 'la-espiga',
      from: 1,
      to: 2,
      limit: 20,
    });

    expect(page.nextCursor).toBeNull();
  });

  it('ties the keyset break to created_at and id together', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    await new D1ValidationRepository(fake.db).listByCompany({
      companyId: 'la-espiga',
      from: 1,
      to: 2,
      cursor: { createdAt: 1_770_000_060, id: 'val-1' },
    });

    expect(fake.calls[0]?.sql).toContain('created_at < ? OR (created_at = ? AND id < ?)');
    expect(fake.calls[0]?.args).toEqual([
      'la-espiga',
      1,
      2,
      1_770_000_060,
      1_770_000_060,
      'val-1',
      21,
    ]);
  });

  it('omits the sandbox filter entirely when it is not asked for', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    await new D1ValidationRepository(fake.db).listByCompany({
      companyId: 'la-espiga',
      from: 1,
      to: 2,
    });

    expect(fake.calls[0]?.sql).not.toContain('is_sandbox = ?');
  });

  it('clamps the page size', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] }, { rows: [] });
    const repository = new D1ValidationRepository(fake.db);

    await repository.listByCompany({ companyId: 'c', from: 1, to: 2, limit: 5000 });
    await repository.listByCompany({ companyId: 'c', from: 1, to: 2, limit: 0 });

    expect(fake.calls[0]?.args.at(-1)).toBe(101);
    expect(fake.calls[1]?.args.at(-1)).toBe(2);
  });
});

describe('dailyTotals', () => {
  it('excludes sandbox and groups on the Venezuela day', async () => {
    const fake = makeFakeD1();
    fake.reply({
      rows: [{ local_date: '2026-08-05', total_count: 12, total_amount_cents: 480_000 }],
    });

    const totals = await new D1ValidationRepository(fake.db).dailyTotals({
      companyId: 'la-espiga',
      from: 1,
      to: 2,
    });

    expect(fake.calls[0]?.sql).toContain('is_sandbox = 0');
    // UTC−4, in seconds. Grouping on the raw epoch would move the boundary to
    // eight in the evening, local.
    expect(fake.calls[0]?.args[0]).toBe(-14_400);
    expect(totals).toEqual([{ date: '2026-08-05', count: 12, amountCents: 480_000 }]);
  });
});

describe('validation cursor', () => {
  it('round-trips', () => {
    const cursor = { createdAt: 1_770_000_060, id: 'a5f0c1e2-0000-4000-8000-000000000001' };
    expect(decodeValidationCursor(encodeValidationCursor(cursor))).toEqual(cursor);
  });

  it('rejects a malformed cursor rather than silently restarting the page', () => {
    expect(decodeValidationCursor('')).toBeNull();
    expect(decodeValidationCursor('nope')).toBeNull();
    expect(decodeValidationCursor('.val-1')).toBeNull();
    expect(decodeValidationCursor('1770000060.')).toBeNull();
    expect(decodeValidationCursor('1.5.val-1')).toBeNull();
  });
});
