import { describe, expect, it } from 'vitest';

import type { Validation } from '../../adapters/d1/validation.repository.ts';
import { makeListValidations, type PageCursor } from './list-validations.ts';

const NOW = 1_770_000_000;

type Query = {
  companyId: string;
  isSandbox?: boolean;
  cashierId?: string;
  from: number;
  to: number;
  cursor?: PageCursor;
  limit?: number;
};

function validation(index: number, overrides: Partial<Validation> = {}): Validation {
  return {
    id: `validation-${String(index).padStart(4, '0')}`,
    companyId: 'la-espiga',
    cashierId: 'user-maria',
    bankAccountId: 'account-1',
    bank: 'banesco',
    kind: 'pago_movil',
    isSandbox: false,
    controlCode: String(100_000 + index),
    reference: `00012345${String(index).padStart(4, '0')}`,
    referenceKey: `12345${String(index).padStart(4, '0')}`,
    amountCents: 124_000,
    currency: 'BS',
    payerPhone: '+584143125566',
    sourceBankId: '0134',
    trnAt: NOW - index * 60,
    latencyMs: 400,
    searchMode: 'exact_reference',
    idempotencyKey: `idem-${index}`,
    createdAt: NOW - index * 60,
    ...overrides,
  };
}

/** The repository's keyset, in memory: same ORDER BY, same "strictly after". */
function fakeValidations(rows: readonly Validation[]) {
  const queries: Query[] = [];

  return {
    queries,
    validations: {
      async listByCompany(query: Query) {
        queries.push(query);
        const limit = query.limit ?? 20;

        const matching = rows
          .filter((row) => row.companyId === query.companyId)
          .filter((row) => query.isSandbox === undefined || row.isSandbox === query.isSandbox)
          .filter((row) => query.cashierId === undefined || row.cashierId === query.cashierId)
          .filter((row) => row.createdAt >= query.from && row.createdAt <= query.to)
          .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : -1))
          .filter((row) => {
            const cursor = query.cursor;
            if (cursor === undefined) return true;
            return (
              row.createdAt < cursor.createdAt ||
              (row.createdAt === cursor.createdAt && row.id < cursor.id)
            );
          });

        const items = matching.slice(0, limit);
        const last = items.at(-1);
        return {
          items,
          nextCursor:
            matching.length > limit && last !== undefined
              ? { createdAt: last.createdAt, id: last.id }
              : null,
        };
      },
    },
  };
}

const RANGE = { companyId: 'la-espiga', from: NOW - 86_400, to: NOW };

describe('by cashier', () => {
  // The filter the merchant's panel offers beside the sandbox toggle. It is a
  // condition the database applies, so it narrows the *scan* too, and it is by
  // id because two cashiers share a first name more often than not.
  const staff = [
    validation(0, { cashierId: 'user-maria' }),
    validation(1, { cashierId: 'user-jose' }),
    validation(2, { cashierId: 'user-maria' }),
  ];

  it('asks the repository for one person’s rows, not everybody’s', async () => {
    const { validations, queries } = fakeValidations(staff);
    const listValidations = makeListValidations({ validations });

    const page = await listValidations({ ...RANGE, cashierId: 'user-maria' });

    expect(page.items.map((item) => item.id)).toEqual(['validation-0000', 'validation-0002']);
    expect(queries[0]?.cashierId).toBe('user-maria');
  });

  it('leaves the filter off when nobody was chosen', async () => {
    const { validations, queries } = fakeValidations(staff);
    const listValidations = makeListValidations({ validations });

    const page = await listValidations(RANGE);

    expect(page.items).toHaveLength(3);
    expect(queries[0]?.cashierId).toBeUndefined();
  });

  it('narrows a searched page by the same condition', async () => {
    // The search path is a bounded scan; the cashier must reach the WHERE rather
    // than being applied to what came back, or the budget is spent on rows that
    // could never match.
    const { validations, queries } = fakeValidations([
      validation(0, { cashierId: 'user-maria', controlCode: '582422' }),
      validation(1, { cashierId: 'user-jose', controlCode: '582422' }),
    ]);
    const listValidations = makeListValidations({ validations });

    const page = await listValidations({ ...RANGE, cashierId: 'user-jose', search: '582422' });

    expect(page.items.map((item) => item.cashierId)).toEqual(['user-jose']);
    expect(queries.every((query) => query.cashierId === 'user-jose')).toBe(true);
  });
});

describe('list validations', () => {
  it('pages twenty at a time in one query', async () => {
    const rows = Array.from({ length: 45 }, (_, index) => validation(index));
    const { validations, queries } = fakeValidations(rows);
    const listValidations = makeListValidations({ validations });

    const page = await listValidations(RANGE);

    expect(page.items).toHaveLength(20);
    expect(page.items[0]?.id).toBe('validation-0000');
    expect(page.nextCursor).toEqual({ createdAt: rows[19].createdAt, id: 'validation-0019' });
    expect(queries).toHaveLength(1);
  });

  it('continues from the cursor without repeating a row', async () => {
    const rows = Array.from({ length: 45 }, (_, index) => validation(index));
    const { validations } = fakeValidations(rows);
    const listValidations = makeListValidations({ validations });

    const first = await listValidations(RANGE);
    const second = await listValidations({ ...RANGE, cursor: first.nextCursor ?? undefined });

    expect(second.items[0]?.id).toBe('validation-0020');
    const ids = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(ids.size).toBe(40);
  });

  it('turns the toggle into the sandbox flag, and Todos into no filter', async () => {
    const { validations, queries } = fakeValidations([]);
    const listValidations = makeListValidations({ validations });

    await listValidations({ ...RANGE, environment: 'production' });
    await listValidations({ ...RANGE, environment: 'sandbox' });
    await listValidations({ ...RANGE, environment: 'all' });
    await listValidations(RANGE);

    expect(queries.map((query) => query.isSandbox)).toEqual([false, true, undefined, undefined]);
  });

  it('finds one payment by a partial reference, deep in the range', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => validation(index));
    const { validations } = fakeValidations(rows);
    const listValidations = makeListValidations({ validations });

    const page = await listValidations({ ...RANGE, search: '0117' });

    expect(page.items.map((item) => item.reference)).toEqual(['000123450117']);
  });

  it('finds a payer by a phone typed the way it is read aloud', async () => {
    const rows = [
      validation(0, { payerPhone: '+584241234567' }),
      validation(1, { payerPhone: '+584143125566' }),
    ];
    const { validations } = fakeValidations(rows);
    const listValidations = makeListValidations({ validations });

    for (const typed of ['0414-3125566', '+58 414 3125566', '4143125566']) {
      const page = await listValidations({ ...RANGE, search: typed });
      expect(page.items.map((item) => item.id)).toEqual(['validation-0001']);
    }
  });

  it('finds a payment by the cajero who ran it, case- and accent-folded', async () => {
    const { validations } = fakeValidations([
      validation(0, { cashierName: 'María Rodríguez' }),
      validation(1, { cashierName: 'Julio Sánchez' }),
    ]);
    const listValidations = makeListValidations({ validations });

    const page = await listValidations({ ...RANGE, search: 'maria' });
    expect(page.items.map((item) => item.id)).toEqual([validation(0).id]);
  });

  it('finds a payment by its amount in whole bolívares', async () => {
    const { validations } = fakeValidations([
      validation(0, { amountCents: 63_000 }),
      validation(1, { amountCents: 12_400 }),
    ]);
    const listValidations = makeListValidations({ validations });

    const page = await listValidations({ ...RANGE, search: '630' });
    expect(page.items.map((item) => item.id)).toEqual([validation(0).id]);
  });

  it('matches nothing for a term with no digits in it', async () => {
    const rows = Array.from({ length: 5 }, (_, index) => validation(index));
    const { validations } = fakeValidations(rows);
    const listValidations = makeListValidations({ validations });

    expect((await listValidations({ ...RANGE, search: 'maría' })).items).toEqual([]);
  });

  it('pages a search without repeating or skipping a match', async () => {
    // Every other row matches, so the page boundary lands mid-batch.
    const rows = Array.from({ length: 200 }, (_, index) =>
      validation(index, { payerPhone: index % 2 === 0 ? '+584143125566' : '+584241234567' }),
    );
    const { validations } = fakeValidations(rows);
    const listValidations = makeListValidations({ validations });

    const first = await listValidations({ ...RANGE, search: '04143125566' });
    const second = await listValidations({
      ...RANGE,
      search: '04143125566',
      cursor: first.nextCursor ?? undefined,
    });

    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(20);
    const ids = new Set([...first.items, ...second.items].map((item) => item.id));
    expect(ids.size).toBe(40);
    expect(first.items.every((item) => item.payerPhone === '+584143125566')).toBe(true);
  });

  it('hands back a cursor when the scan budget runs out, never a false end', async () => {
    // Nothing matches, and there is far more history than one request may read.
    const rows = Array.from({ length: 900 }, (_, index) => validation(index));
    const { validations, queries } = fakeValidations(rows);
    const listValidations = makeListValidations({ validations });

    const page = await listValidations({ ...RANGE, search: '999999999' });

    expect(page.items).toEqual([]);
    // A null cursor here would tell the panel the history ended at row 500.
    expect(page.nextCursor).not.toBeNull();
    expect(queries).toHaveLength(5);
  });

  it('ends the list when the range is genuinely exhausted', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => validation(index));
    const { validations } = fakeValidations(rows);
    const listValidations = makeListValidations({ validations });

    const page = await listValidations({ ...RANGE, search: '000123450029' });

    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });
});
