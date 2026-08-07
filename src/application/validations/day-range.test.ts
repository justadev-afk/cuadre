import { describe, expect, it } from 'vitest';

import { venezuelaDate } from '../../shared/clock.ts';
import {
  endOfVenezuelaDay,
  lastVenezuelaDays,
  type NamedRange,
  startOfVenezuelaDay,
  venezuelaDayRange,
} from './day-range.ts';

/** 2026-02-02 02:40 UTC, which is still the evening of the 1st in Caracas. */
const LATE_EVENING = 1_770_000_000;

describe('venezuela day boundaries', () => {
  it('puts an evening after UTC midnight in the day the shop had', () => {
    expect(venezuelaDate(LATE_EVENING)).toBe('2026-02-01');
    expect(venezuelaDate(startOfVenezuelaDay(LATE_EVENING))).toBe('2026-02-01');
    expect(venezuelaDate(endOfVenezuelaDay(LATE_EVENING))).toBe('2026-02-01');
  });

  it('starts the day at 04:00 UTC and ends it a second before the next', () => {
    const start = startOfVenezuelaDay(LATE_EVENING);
    expect(new Date(start * 1000).toISOString()).toBe('2026-02-01T04:00:00.000Z');
    expect(endOfVenezuelaDay(LATE_EVENING) - start).toBe(86_399);
  });

  it('is idempotent inside its own day', () => {
    const start = startOfVenezuelaDay(LATE_EVENING);
    expect(startOfVenezuelaDay(start)).toBe(start);
    expect(startOfVenezuelaDay(start + 86_399)).toBe(start);
    expect(startOfVenezuelaDay(start + 86_400)).toBe(start + 86_400);
  });

  const cases: Array<{ range: NamedRange; first: string; last: string; days: number }> = [
    { range: 'today', first: '2026-02-01', last: '2026-02-01', days: 1 },
    { range: 'yesterday', first: '2026-01-31', last: '2026-01-31', days: 1 },
    // Today and the six before it — the way a shopkeeper counts a week.
    { range: 'last_7_days', first: '2026-01-26', last: '2026-02-01', days: 7 },
  ];

  for (const { range, first, last, days } of cases) {
    it(`covers ${days} day(s) for '${range}'`, () => {
      const { from, to } = venezuelaDayRange(range, LATE_EVENING);
      expect(venezuelaDate(from)).toBe(first);
      expect(venezuelaDate(to)).toBe(last);
      expect(to - from + 1).toBe(days * 86_400);
    });
  }

  it('leaves no second between yesterday and today', () => {
    const yesterday = venezuelaDayRange('yesterday', LATE_EVENING);
    const today = venezuelaDayRange('today', LATE_EVENING);
    expect(today.from - yesterday.to).toBe(1);
  });

  it('counts the last N days inclusive of today, and refuses a zero span', () => {
    expect(lastVenezuelaDays(1, LATE_EVENING)).toEqual(venezuelaDayRange('today', LATE_EVENING));
    expect(lastVenezuelaDays(7, LATE_EVENING)).toEqual(
      venezuelaDayRange('last_7_days', LATE_EVENING),
    );
    expect(lastVenezuelaDays(0, LATE_EVENING)).toEqual(venezuelaDayRange('today', LATE_EVENING));
  });
});
