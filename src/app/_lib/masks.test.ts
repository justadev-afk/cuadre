import { describe, expect, it } from 'vitest';

import { maskDate, readTypedDate } from './masks.ts';

/**
 * The date the cashier types. It is the one masked field whose value reaches the
 * *bank* rather than only the domain — it becomes `startDt`, and Banesco answers
 * "sin resultados" to a day that is off by one however real the payment is. So
 * the table is the specification, and a wrong reading here is a payment nobody
 * can validate.
 */
describe('maskDate', () => {
  const table: ReadonlyArray<[string, string, string]> = [
    ['1', '1', 'never invents the leading zero the cashier has not typed'],
    ['10', '10', 'the day alone stands on its own'],
    ['100', '10/0', 'the slash appears as the month starts'],
    ['1007', '10/07', 'day and month, no year yet'],
    ['100720', '10/07/20', 'the year fills in as it is typed'],
    ['10072026', '10/07/2026', 'complete'],
    ['100720261', '10/07/2026', 'and capped there — a date has eight digits'],
    ['10/07/2026', '10/07/2026', 're-masking its own output changes nothing'],
    ['ab', '', 'letters are not digits'],
    ['', '', 'empty stays empty'],
  ];

  for (const [typed, shown, why] of table) {
    it(`${typed || '∅'} → ${shown || '∅'} — ${why}`, () => {
      expect(maskDate(typed)).toBe(shown);
    });
  }
});

describe('readTypedDate', () => {
  const Today = '2026-08-11';

  it('reads a Venezuelan date, day first', () => {
    expect(readTypedDate('10/07/2026', Today)).toBe('2026-07-10');
  });

  it('pads a single-digit day and month', () => {
    expect(readTypedDate('2/7/2026', Today)).toBe('2026-07-02');
  });

  it('takes this year when the year is left off', () => {
    expect(readTypedDate('10/07', Today)).toBe('2026-07-10');
  });

  it('accepts today itself', () => {
    expect(readTypedDate('11/08/2026', Today)).toBe(Today);
  });

  it('refuses tomorrow: a payment cannot have happened yet', () => {
    expect(readTypedDate('12/08/2026', Today)).toBeNull();
  });

  it('refuses a day the calendar does not have', () => {
    // 31/02 rolls over to 03/03 in a `Date`, which would silently ask the bank
    // about a different day than the one that was typed.
    expect(readTypedDate('31/02/2026', Today)).toBeNull();
    expect(readTypedDate('31/04/2026', Today)).toBeNull();
    expect(readTypedDate('00/07/2026', Today)).toBeNull();
    expect(readTypedDate('10/13/2026', Today)).toBeNull();
  });

  it('keeps the 29th of a leap February', () => {
    expect(readTypedDate('29/02/2024', Today)).toBe('2024-02-29');
    expect(readTypedDate('29/02/2026', Today)).toBeNull();
  });

  it.each(['', '10', '10/', '10/07/20', 'ab/cd/efgh', '10/07/2026/1'])(
    'refuses the incomplete or malformed %s',
    (typed) => {
      expect(readTypedDate(typed, Today)).toBeNull();
    },
  );

  it('round-trips whatever the mask produced', () => {
    expect(readTypedDate(maskDate('10072026'), Today)).toBe('2026-07-10');
  });
});
