import { describe, expect, it } from 'vitest';

import type { ValidationStats as ValidationStatsRows } from '../../adapters/d1/validation.repository.ts';
import { fixedClock, venezuelaDate } from '../../shared/clock.ts';
import { MAX_STATS_DAYS, makeValidationStats } from './validation-stats.ts';

/** 2026-02-01, 22:40 in Caracas — late enough that UTC has already turned over. */
const NOW = 1_770_000_000;

const EMPTY: ValidationStatsRows = {
  byDay: [],
  byHour: [],
  byCashier: [],
  bySourceBank: [],
  byKind: [],
  summary: { count: 0, amountCents: 0, maxAmountCents: 0, payers: 0 },
};

type Query = { companyId: string; from: number; to: number };

function fakeValidations(rows: Partial<ValidationStatsRows> = {}) {
  const queries: Query[] = [];
  return {
    queries,
    validations: {
      async stats(query: Query) {
        queries.push(query);
        return { ...EMPTY, ...rows };
      },
    },
  };
}

function statsFor(rows: Partial<ValidationStatsRows> = {}) {
  const { validations, queries } = fakeValidations(rows);
  return { queries, validationStats: makeValidationStats({ validations, clock: fixedClock(NOW) }) };
}

describe('the range', () => {
  it('reads the last seven Venezuelan days when nothing was asked for', async () => {
    const { validationStats, queries } = statsFor();

    const view = await validationStats({ companyId: 'la-espiga' });

    expect(view.range.preset).toBe('last_7_days');
    expect(view.range.fromDay).toBe('2026-01-26');
    expect(view.range.toDay).toBe('2026-02-01');
    expect(view.range.days).toBe(7);
    expect(venezuelaDate(queries[0]?.from ?? 0)).toBe('2026-01-26');
  });

  it('resolves each preset to whole local days', async () => {
    const { validationStats } = statsFor();

    const spans = await Promise.all(
      (['today', 'yesterday', 'last_30_days', 'this_month', 'last_month'] as const).map((preset) =>
        validationStats({ companyId: 'la-espiga', preset }),
      ),
    );

    expect(spans.map((view) => [view.range.fromDay, view.range.toDay, view.range.days])).toEqual([
      ['2026-02-01', '2026-02-01', 1],
      ['2026-01-31', '2026-01-31', 1],
      ['2026-01-03', '2026-02-01', 30],
      // "Este mes" ends today, not at the end of the month: padding the axis
      // with three empty weeks of future would hide the shape of the month.
      ['2026-02-01', '2026-02-01', 1],
      ['2026-01-01', '2026-01-31', 31],
    ]);
  });

  it('takes two days off the calendar over the preset', async () => {
    const { validationStats } = statsFor();

    const view = await validationStats({
      companyId: 'la-espiga',
      preset: 'today',
      from: '2026-01-10',
      to: '2026-01-12',
    });

    expect([view.range.preset, view.range.fromDay, view.range.toDay, view.range.days]).toEqual([
      'custom',
      '2026-01-10',
      '2026-01-12',
      3,
    ]);
  });

  it('straightens a range typed backwards, and pulls a future end back to today', async () => {
    const { validationStats } = statsFor();

    const backwards = await validationStats({
      companyId: 'la-espiga',
      from: '2026-01-12',
      to: '2026-01-10',
    });
    const future = await validationStats({
      companyId: 'la-espiga',
      from: '2026-01-30',
      to: '2027-01-01',
    });

    expect([backwards.range.fromDay, backwards.range.toDay]).toEqual(['2026-01-10', '2026-01-12']);
    expect([future.range.fromDay, future.range.toDay]).toEqual(['2026-01-30', '2026-02-01']);
  });

  it('clamps a span longer than a quarter, keeping the recent end of it', async () => {
    const { validationStats, queries } = statsFor();

    const view = await validationStats({
      companyId: 'la-espiga',
      from: '2020-01-01',
      to: '2026-02-01',
    });

    expect(view.range.days).toBe(MAX_STATS_DAYS);
    expect(view.range.toDay).toBe('2026-02-01');
    expect(view.range.clamped).toBe(true);
    // And the *query* is the clamped one — a screen that ignores the flag still
    // cannot make the database walk six years of a merchant's history.
    expect(venezuelaDate(queries[0]?.from ?? 0)).toBe(view.range.fromDay);
  });

  it('falls back to the preset when only half a custom range arrives', async () => {
    const { validationStats } = statsFor();

    const view = await validationStats({ companyId: 'la-espiga', from: '2026-01-10' });

    expect(view.range.preset).toBe('last_7_days');
  });
});

describe('the shape a chart needs', () => {
  it('fills the days nobody paid on, oldest first', async () => {
    const { validationStats } = statsFor({
      byDay: [
        { date: '2026-02-01', count: 2, amountCents: 20_000 },
        { date: '2026-01-30', count: 1, amountCents: 5_000 },
      ],
      summary: { count: 3, amountCents: 25_000, maxAmountCents: 15_000, payers: 2 },
    });

    const view = await validationStats({ companyId: 'la-espiga', preset: 'last_7_days' });

    expect(view.series).toHaveLength(7);
    expect(view.series[0]?.date).toBe('2026-01-26');
    expect(view.series.at(-1)).toEqual({ date: '2026-02-01', count: 2, amountCents: 20_000 });
    // A quiet Tuesday is a zero on the axis, never a missing column that would
    // close the gap and make the week read as busier than it was.
    expect(view.series[1]).toEqual({ date: '2026-01-27', count: 0, amountCents: 0 });
    expect(view.activeDays).toBe(2);
  });

  it('answers with all twenty-four hours whatever the group by returned', async () => {
    const { validationStats } = statsFor({
      byHour: [{ key: '14', count: 3, amountCents: 30_000 }],
    });

    const view = await validationStats({ companyId: 'la-espiga' });

    expect(view.byHour).toHaveLength(24);
    expect(view.byHour[0]).toEqual({ hour: 0, count: 0, amountCents: 0 });
    expect(view.byHour[14]).toEqual({ hour: 14, count: 3, amountCents: 30_000 });
  });

  it('answers with both kinds, so a zero reads as a zero', async () => {
    const { validationStats } = statsFor({
      byKind: [{ key: 'pago_movil', count: 4, amountCents: 40_000 }],
    });

    const view = await validationStats({ companyId: 'la-espiga' });

    expect(view.byKind).toEqual([
      { kind: 'pago_movil', count: 4, amountCents: 40_000 },
      { kind: 'transferencia', count: 0, amountCents: 0 },
    ]);
  });

  it('names the payer bank, and keeps the code when Sudeban has moved on', async () => {
    const { validationStats } = statsFor({
      bySourceBank: [
        { key: '0102', count: 1, amountCents: 1_000 },
        { key: '0199', count: 2, amountCents: 90_000 },
      ],
    });

    const view = await validationStats({ companyId: 'la-espiga' });

    expect(view.bySourceBank).toEqual([
      { key: '0199', label: null, count: 2, amountCents: 90_000 },
      { key: '0102', label: 'Banco de Venezuela', count: 1, amountCents: 1_000 },
    ]);
  });

  it('ranks the cashiers by money, most first', async () => {
    const { validationStats } = statsFor({
      byCashier: [
        { key: 'user-jose', name: 'José P.', count: 9, amountCents: 10_000 },
        { key: 'user-maria', name: 'María R.', count: 2, amountCents: 80_000 },
      ],
    });

    const view = await validationStats({ companyId: 'la-espiga' });

    expect(view.byCashier.map((row) => row.key)).toEqual(['user-maria', 'user-jose']);
  });

  it('names the strongest day, and none at all when nothing was validated', async () => {
    const busy = statsFor({
      byDay: [
        { date: '2026-01-31', count: 9, amountCents: 90_000 },
        { date: '2026-02-01', count: 1, amountCents: 10_000 },
      ],
    });
    const quiet = statsFor();

    expect((await busy.validationStats({ companyId: 'la-espiga' })).bestDay?.date).toBe(
      '2026-01-31',
    );
    expect((await quiet.validationStats({ companyId: 'la-espiga' })).bestDay).toBeNull();
  });
});

describe('the numbers over the charts', () => {
  it('averages the ticket over the payments and the day over the whole span', async () => {
    const { validationStats } = statsFor({
      summary: { count: 4, amountCents: 100_000, maxAmountCents: 60_000, payers: 3 },
    });

    const view = await validationStats({ companyId: 'la-espiga', preset: 'last_7_days' });

    expect(view.averageTicketCents).toBe(25_000);
    // Seven days, not the two that saw a payment: what a day here is worth.
    expect(view.dailyAverageAmountCents).toBe(Math.round(100_000 / 7));
  });

  it('answers zero rather than NaN for a span with no payments', async () => {
    const { validationStats } = statsFor();

    const view = await validationStats({ companyId: 'la-espiga' });

    expect([view.averageTicketCents, view.dailyAverageAmountCents, view.totalAmountCents]).toEqual([
      0, 0, 0,
    ]);
  });

  it('offers no way to ask for sandbox money', async () => {
    const { validationStats, queries } = statsFor();

    await validationStats({ companyId: 'la-espiga' });

    // A company and a range, and nothing else: excluding sandbox is the
    // repository's SQL and there is no parameter here that could turn it off.
    expect(Object.keys(queries[0] ?? {}).sort()).toEqual(['companyId', 'from', 'to']);
  });
});
