import { describe, expect, it } from 'vitest';

import { maskDate, readTypedDate, remask } from './masks.ts';

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

/**
 * The caret, across a re-format. This is the rule that decides whether a masked
 * field can be *edited* rather than only typed into: without it every keystroke
 * throws the caret to the end, so correcting one digit of a phone number the
 * customer is reading out shifts the rest of it and the next digit lands
 * somewhere else again. The cashier's word for that was "se rompe todo".
 *
 * The counter's phone mask, `formatPhoneLoose`: digits, a hyphen after the
 * trunk, nothing invented.
 */
describe('remask', () => {
  const phone = (raw: string): string => {
    const digits = raw.replace(/\D/g, '').slice(0, 11);
    return digits.length <= 4 ? digits : `${digits.slice(0, 4)}-${digits.slice(4)}`;
  };

  const table: ReadonlyArray<[string, number, string, number, string]> = [
    ['04143125566', 11, '0414-3125566', 12, 'typing on: the caret follows the last digit'],
    ['0414', 4, '0414', 4, 'and does not jump the hyphen that has not appeared yet'],
    ['04145', 5, '0414-5', 6, 'the hyphen appears under the caret, which steps over it'],
    [
      '0414-31255669',
      6,
      '0414-3125566',
      6,
      'a digit typed into a full number: the caret stays where it was typed, not at the end',
    ],
    [
      '0414-125566',
      5,
      '0414-125566',
      4,
      'a digit deleted mid-number leaves the caret on the same digit boundary — the far side of the hyphen is the same place to type the replacement',
    ],
    ['044-3125566', 3, '0443-125566', 3, 'even where every digit after it shifted left'],
    ['0414-3125566', 0, '0414-3125566', 0, 'the start is the start'],
    ['', 0, '', 0, 'an emptied field'],
  ];

  for (const [raw, caret, value, at, why] of table) {
    it(`${raw || '∅'}@${caret} → ${value || '∅'}@${at} — ${why}`, () => {
      expect(remask(raw, caret, phone)).toEqual({ value, caret: at });
    });
  }

  it('never points past the end of what the mask kept', () => {
    // The mask caps at eleven digits, so a twelfth typed at the end has nowhere
    // for the caret to go but the end of what survived.
    expect(remask('041431255669', 12, phone)).toEqual({ value: '0414-3125566', caret: 12 });
  });
});
