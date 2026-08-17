import { describe, expect, it } from 'vitest';

import { formatBankDateTime, formatValidatedAt } from './venezuela-format.ts';

/** 2026-08-17, 11:02 in Caracas — a Monday morning behind a counter. */
const NOW = Date.parse('2026-08-17T15:02:00Z') / 1000;
const SECONDS_PER_DAY = 86_400;

/**
 * The column that used to read 00:00 on every row of the panel, forever.
 *
 * It was drawing the bank's `trnAt`, and Banesco reports a pago móvil with
 * `trnTime` "00.00.00" — a date and no time at all. What it draws now is when
 * the counter validated, which is also what the list is ordered by; and it drops
 * the hour once the row is not today's, because the hour of something that
 * happened last Tuesday is not what anybody reconciles a receipt against.
 */
describe('formatValidatedAt', () => {
  const table: ReadonlyArray<[number, string, string]> = [
    [NOW, '11:02', 'today is an hour — the date is already on the header'],
    [NOW - 3 * 3600, '08:02', 'and so is earlier this morning'],
    [
      Date.parse('2026-08-17T04:10:00Z') / 1000,
      '00:10',
      'ten past midnight is still today in Caracas, and still an hour',
    ],
    [
      Date.parse('2026-08-17T03:50:00Z') / 1000,
      '16/08/2026',
      'ten to midnight local is yesterday — the day ends at midnight in Caracas, not in UTC',
    ],
    [NOW - SECONDS_PER_DAY, '16/08/2026', 'yesterday is a date, with no hour'],
    [NOW - 6 * SECONDS_PER_DAY, '11/08/2026', 'and so is the far end of the 7-day tab'],
  ];

  for (const [at, shown, why] of table) {
    it(`${shown} — ${why}`, () => {
      expect(formatValidatedAt(at, NOW)).toBe(shown);
    });
  }
});

/**
 * The bank's own timestamp, and the time it did not give. "12:00 a.m." on a
 * receipt is a minute Banesco never reported.
 */
describe('formatBankDateTime', () => {
  it('drops the time when the bank reported none — trnTime "00.00.00"', () => {
    expect(formatBankDateTime(Date.parse('2026-07-10T04:00:00Z') / 1000)).toBe('10/07/2026');
  });

  it('keeps it when there is one', () => {
    expect(formatBankDateTime(Date.parse('2026-07-10T14:30:00Z') / 1000)).toBe(
      '10/07/2026 · 10:30 a.m.',
    );
  });

  it('and in the afternoon', () => {
    expect(formatBankDateTime(Date.parse('2026-07-10T20:05:00Z') / 1000)).toBe(
      '10/07/2026 · 4:05 p.m.',
    );
  });
});
