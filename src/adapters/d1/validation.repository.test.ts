import { describe, expect, it } from 'vitest';

import { epochToIso } from '../../shared/clock.ts';
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
    kind: 'pago_movil',
    is_sandbox: 0,
    control_code: '481920',
    reference: '00012345678',
    reference_key: '12345678',
    amount_cents: 124_000,
    currency: 'BS',
    payer_phone: '+584143125566',
    source_bank_id: '0134',
    trn_at: epochToIso(1_770_000_000),
    latency_ms: 812,
    search_mode: 'exact_reference',
    idempotency_key: 'idem-1',
    created_at: epochToIso(1_770_000_060),
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
      kind: 'pago_movil',
      isSandbox: false,
      controlCode: '481920',
      reference: '00012345678',
      referenceKey: '12345678',
      amountCents: 124_000,
      currency: 'BS',
      payerPhone: '+584143125566',
      sourceBankId: '0134',
      trnAt: 1_770_000_000,
      latencyMs: 812,
      searchMode: 'exact_reference',
      idempotencyKey: 'idem-1',
      createdAt: 1_770_000_060,
      // Populated only by the list queries' LEFT JOINs; null on a bare row.
      cashierName: null,
      accountLabel: null,
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
      { throws: uniqueViolation('validations.bank_account_id', 'validations.reference_key') },
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
      { throws: uniqueViolation('validations.bank_account_id', 'validations.reference_key') },
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

    expect(fake.calls[0]?.sql).toContain('v.created_at < ? OR (v.created_at = ? AND v.id < ?)');
    expect(fake.calls[0]?.args).toEqual([
      'la-espiga',
      epochToIso(1),
      epochToIso(2),
      epochToIso(1_770_000_060),
      epochToIso(1_770_000_060),
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

  it('narrows to one cashier without loosening the company scope', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    await new D1ValidationRepository(fake.db).listByCompany({
      companyId: 'la-espiga',
      cashierId: 'user-maria',
      from: 1,
      to: 2,
    });

    // Both conditions, always: a cashier id is a uuid the caller supplies, and
    // a query narrowed by it *instead* of by the company is one that can be
    // pointed at another merchant's staff.
    expect(fake.calls[0]?.sql).toContain('v.company_id = ?');
    expect(fake.calls[0]?.sql).toContain('v.cashier_id = ?');
    expect(fake.calls[0]?.args.slice(0, 4)).toEqual([
      'la-espiga',
      '1970-01-01T00:00:01Z',
      '1970-01-01T00:00:02Z',
      'user-maria',
    ]);
  });

  it('omits the cashier condition when nobody was chosen', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    await new D1ValidationRepository(fake.db).listByCompany({
      companyId: 'la-espiga',
      from: 1,
      to: 2,
    });

    expect(fake.calls[0]?.sql).not.toContain('cashier_id = ?');
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
    // UTC−4, as a SQLite datetime modifier on the ISO column. Grouping on the raw
    // UTC day would move the boundary to eight in the evening, local.
    expect(fake.calls[0]?.args[0]).toBe('-240 minutes');
    expect(totals).toEqual([{ date: '2026-08-05', count: 12, amountCents: 480_000 }]);
  });
});

describe('stats', () => {
  /** The six replies, in the order `stats` batches its statements. */
  function replies() {
    return [
      { rows: [{ local_date: '2026-08-05', total_count: 12, total_amount_cents: 480_000 }] },
      { rows: [{ bucket_key: '14', total_count: 5, total_amount_cents: 200_000 }] },
      {
        rows: [
          {
            bucket_key: 'user-1',
            cashier_name: 'María R.',
            total_count: 12,
            total_amount_cents: 480_000,
          },
        ],
      },
      { rows: [{ bucket_key: '0102', total_count: 7, total_amount_cents: 300_000 }] },
      { rows: [{ bucket_key: 'pago_movil', total_count: 12, total_amount_cents: 480_000 }] },
      {
        rows: [
          {
            total_count: 12,
            total_amount_cents: 480_000,
            max_amount_cents: 90_000,
            payers: 9,
          },
        ],
      },
    ];
  }

  it('maps every breakdown, and the cashier name off the join', async () => {
    const fake = makeFakeD1();
    fake.reply(...replies());

    const stats = await new D1ValidationRepository(fake.db).stats({
      companyId: 'la-espiga',
      from: 1,
      to: 2,
    });

    expect(stats.byDay).toEqual([{ date: '2026-08-05', count: 12, amountCents: 480_000 }]);
    expect(stats.byHour).toEqual([{ key: '14', count: 5, amountCents: 200_000 }]);
    expect(stats.byCashier).toEqual([
      { key: 'user-1', name: 'María R.', count: 12, amountCents: 480_000 },
    ]);
    expect(stats.bySourceBank).toEqual([{ key: '0102', count: 7, amountCents: 300_000 }]);
    expect(stats.byKind).toEqual([{ key: 'pago_movil', count: 12, amountCents: 480_000 }]);
    expect(stats.summary).toEqual({
      count: 12,
      amountCents: 480_000,
      maxAmountCents: 90_000,
      payers: 9,
    });
  });

  it('scopes and de-sandboxes every one of the six statements', async () => {
    const fake = makeFakeD1();
    fake.reply(...replies());

    await new D1ValidationRepository(fake.db).stats({ companyId: 'la-espiga', from: 1, to: 2 });

    expect(fake.calls).toHaveLength(6);
    for (const call of fake.calls) {
      expect(call.sql).toContain('v.company_id = ?');
      // A total is money, and a test payment is not. There is no parameter that
      // could turn this off, and no statement here is allowed to forget it.
      expect(call.sql).toContain('v.is_sandbox = 0');
      expect(call.args).toContain('la-espiga');
    }
    // The day and the hour are both shifted to Caracas by the same modifier, so
    // an eleven-at-night payment cannot land on tomorrow in one and today in
    // the other.
    expect(fake.calls[0]?.args[0]).toBe('-240 minutes');
    expect(fake.calls[1]?.args[0]).toBe('-240 minutes');
  });

  it('reads an empty span as zeros rather than refusing a null sum', async () => {
    const fake = makeFakeD1();
    // COALESCE is the repository's, so an empty range answers with a row of
    // zeros; what this proves is that the mapping does not then trip over it.
    fake.reply(
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [] },
      { rows: [{ total_count: 0, total_amount_cents: 0, max_amount_cents: 0, payers: 0 }] },
    );

    const stats = await new D1ValidationRepository(fake.db).stats({
      companyId: 'la-espiga',
      from: 1,
      to: 2,
    });

    expect(stats.byDay).toEqual([]);
    expect(stats.summary).toEqual({ count: 0, amountCents: 0, maxAmountCents: 0, payers: 0 });
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
