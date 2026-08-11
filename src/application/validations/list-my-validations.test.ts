import { describe, expect, it } from 'vitest';

import type { Validation } from '../../adapters/d1/validation.repository.ts';
import { fixedClock, venezuelaDate } from '../../shared/clock.ts';
import { makeListMyValidations } from './list-my-validations.ts';
import type { PageCursor } from './list-validations.ts';

const NOW = 1_770_000_000;

type Query = {
  cashierId: string;
  from: number;
  to: number;
  cursor?: PageCursor;
  limit?: number;
};

function validation(overrides: Partial<Validation> = {}): Validation {
  return {
    id: 'validation-1',
    companyId: 'la-espiga',
    cashierId: 'user-maria',
    bankAccountId: 'account-1',
    bank: 'banesco',
    kind: 'pago_movil',
    isSandbox: false,
    controlCode: '654321',
    reference: '000123456789',
    referenceKey: '123456789',
    amountCents: 124_000,
    currency: 'BS',
    payerPhone: '584143125566',
    sourceBankId: '0134',
    trnAt: NOW - 300,
    latencyMs: 400,
    searchMode: 'exact_reference',
    idempotencyKey: 'idem-1',
    createdAt: NOW - 300,
    ...overrides,
  };
}

function fakeValidations(rows: readonly Validation[]) {
  const queries: Query[] = [];
  return {
    queries,
    validations: {
      async listByCashier(query: Query) {
        queries.push(query);
        return {
          items: rows.filter((row) => row.cashierId === query.cashierId),
          nextCursor: null,
        };
      },
    },
  };
}

const INPUT = { companyId: 'la-espiga', cashierId: 'user-maria' };

describe('list my validations', () => {
  it('defaults to the Venezuelan day the cashier is standing in', async () => {
    const { validations, queries } = fakeValidations([validation()]);
    const listMyValidations = makeListMyValidations({ validations, clock: fixedClock(NOW) });

    const page = await listMyValidations(INPUT);

    // 02:40 UTC on the 2nd is still the evening shift of the 1st in Caracas.
    expect(venezuelaDate(queries[0]?.from ?? 0)).toBe('2026-02-01');
    expect(venezuelaDate(queries[0]?.to ?? 0)).toBe('2026-02-01');
    expect(page.items).toHaveLength(1);
    expect(page.from).toBe(queries[0]?.from);
  });

  it('asks for ten and shows sandbox rows alongside the rest', async () => {
    const rows = [validation(), validation({ id: 'validation-2', isSandbox: true })];
    const { validations, queries } = fakeValidations(rows);
    const listMyValidations = makeListMyValidations({ validations, clock: fixedClock(NOW) });

    const page = await listMyValidations(INPUT);

    expect(queries[0]?.limit).toBe(10);
    // A cashier testing against the sandbox has to see what they just did; the
    // badge on the row is what tells them apart, not their absence.
    expect(page.items.map((item) => item.isSandbox)).toEqual([false, true]);
  });

  it('moves the window a whole day back for ayer', async () => {
    const { validations, queries } = fakeValidations([]);
    const listMyValidations = makeListMyValidations({ validations, clock: fixedClock(NOW) });

    await listMyValidations({ ...INPUT, range: 'yesterday' });

    expect(venezuelaDate(queries[0]?.from ?? 0)).toBe('2026-01-31');
    expect(venezuelaDate(queries[0]?.to ?? 0)).toBe('2026-01-31');
  });

  it('spans today and the six days before it for 7 días', async () => {
    const { validations, queries } = fakeValidations([]);
    const listMyValidations = makeListMyValidations({ validations, clock: fixedClock(NOW) });

    await listMyValidations({ ...INPUT, range: 'last_7_days' });

    expect(venezuelaDate(queries[0]?.from ?? 0)).toBe('2026-01-26');
    expect(venezuelaDate(queries[0]?.to ?? 0)).toBe('2026-02-01');
  });

  it('drops a row that belongs to another company rather than rendering it', async () => {
    const rows = [validation(), validation({ id: 'validation-2', companyId: 'otra-empresa' })];
    const { validations } = fakeValidations(rows);
    const listMyValidations = makeListMyValidations({ validations, clock: fixedClock(NOW) });

    const page = await listMyValidations(INPUT);

    expect(page.items.map((item) => item.id)).toEqual(['validation-1']);
  });

  describe('search', () => {
    const rows = [
      validation({
        id: 'a',
        reference: '000123456789',
        controlCode: '654321',
        amountCents: 124_000,
      }),
      validation({
        id: 'b',
        reference: '000999888777',
        controlCode: '111222',
        amountCents: 63_000,
      }),
    ];

    it('narrows to the row whose reference carries the digits', async () => {
      const { validations } = fakeValidations(rows);
      const listMyValidations = makeListMyValidations({ validations, clock: fixedClock(NOW) });

      const page = await listMyValidations({ ...INPUT, search: '999888' });

      expect(page.items.map((item) => item.id)).toEqual(['b']);
    });

    it('finds a charge by its control code', async () => {
      const { validations } = fakeValidations(rows);
      const listMyValidations = makeListMyValidations({ validations, clock: fixedClock(NOW) });

      const page = await listMyValidations({ ...INPUT, search: '654321' });

      expect(page.items.map((item) => item.id)).toEqual(['a']);
    });

    it('finds a charge by its whole-bolívar amount', async () => {
      const { validations } = fakeValidations(rows);
      const listMyValidations = makeListMyValidations({ validations, clock: fixedClock(NOW) });

      // 63 000 cents is Bs 630 — "630" finds it and not the Bs 1 240 row.
      const page = await listMyValidations({ ...INPUT, search: '630' });

      expect(page.items.map((item) => item.id)).toEqual(['b']);
    });

    it('returns nothing when the term matches no field', async () => {
      const { validations } = fakeValidations(rows);
      const listMyValidations = makeListMyValidations({ validations, clock: fixedClock(NOW) });

      const page = await listMyValidations({ ...INPUT, search: '000000' });

      expect(page.items).toHaveLength(0);
    });

    it('never returns another company row, even when the term matches it', async () => {
      const shared = [
        validation({ id: 'mine', reference: '000123456789' }),
        validation({ id: 'theirs', reference: '000123456789', companyId: 'otra-empresa' }),
      ];
      const { validations } = fakeValidations(shared);
      const listMyValidations = makeListMyValidations({ validations, clock: fixedClock(NOW) });

      const page = await listMyValidations({ ...INPUT, search: '123456' });

      expect(page.items.map((item) => item.id)).toEqual(['mine']);
    });
  });
});
