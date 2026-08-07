import { describe, expect, it } from 'vitest';

import type { DailyTotal } from '../../adapters/d1/validation.repository.ts';
import { fixedClock, venezuelaDate } from '../../shared/clock.ts';
import { makeDailyTotals } from './daily-totals.ts';

const NOW = 1_770_000_000;

type Query = { companyId: string; from: number; to: number };

function fakeValidations(totals: readonly DailyTotal[]) {
  const queries: Query[] = [];
  return {
    queries,
    validations: {
      async dailyTotals(query: Query) {
        queries.push(query);
        return totals;
      },
    },
  };
}

const TOTALS: DailyTotal[] = [
  { date: '2026-02-01', count: 12, amountCents: 1_488_000 },
  { date: '2026-01-31', count: 8, amountCents: 992_000 },
];

describe('daily totals', () => {
  it('sums the days it was given, most recent first', async () => {
    const { validations } = fakeValidations(TOTALS);
    const dailyTotals = makeDailyTotals({ validations, clock: fixedClock(NOW) });

    const result = await dailyTotals({ companyId: 'la-espiga' });

    expect(result.days).toEqual(TOTALS);
    expect(result.totalCount).toBe(20);
    expect(result.totalAmountCents).toBe(2_480_000);
  });

  it('covers a Venezuelan week by default', async () => {
    const { validations, queries } = fakeValidations([]);
    const dailyTotals = makeDailyTotals({ validations, clock: fixedClock(NOW) });

    await dailyTotals({ companyId: 'la-espiga' });

    expect(venezuelaDate(queries[0]?.from ?? 0)).toBe('2026-01-26');
    expect(venezuelaDate(queries[0]?.to ?? 0)).toBe('2026-02-01');
  });

  it('clamps the span rather than scanning a company history', async () => {
    const { validations, queries } = fakeValidations([]);
    const dailyTotals = makeDailyTotals({ validations, clock: fixedClock(NOW) });

    await dailyTotals({ companyId: 'la-espiga', days: 3_650 });
    await dailyTotals({ companyId: 'la-espiga', days: 0 });

    expect(venezuelaDate(queries[0]?.from ?? 0)).toBe('2026-01-02');
    expect(venezuelaDate(queries[1]?.from ?? 0)).toBe('2026-02-01');
  });

  it('offers no way to ask for sandbox money', async () => {
    const { validations, queries } = fakeValidations([]);
    const dailyTotals = makeDailyTotals({ validations, clock: fixedClock(NOW) });

    await dailyTotals({ companyId: 'la-espiga' });

    // The query carries a company and a range and nothing else: excluding
    // sandbox is the repository's SQL, and there is no parameter here that
    // could ever turn it off.
    expect(Object.keys(queries[0] ?? {}).sort()).toEqual(['companyId', 'from', 'to']);
  });
});
