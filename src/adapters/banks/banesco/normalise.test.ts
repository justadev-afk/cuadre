import { describe, expect, it } from 'vitest';

import {
  decimalToCents,
  lastFour,
  maskAccountNumber,
  padSudebanId,
  venezuelaLocalToEpochSeconds,
} from './normalise.ts';

describe('decimalToCents', () => {
  it.each([
    ['1240.00', 124_000],
    ['1240.10', 124_010],
    ['1240.5', 124_050],
    ['1240', 124_000],
    ['0.01', 1],
    [' 99.99 ', 9999],
    ['-15.25', -1525],
  ] as ReadonlyArray<[string, number]>)('reads %s as %i cents', (value, cents) => {
    expect(decimalToCents(value)).toBe(cents);
  });

  it('keeps the cent that a float loses', () => {
    // Number('1240.10') * 100 is 124009.99999999999.
    expect(decimalToCents('1240.10')).toBe(124_010);
  });

  it('reads a number the bank sent unquoted', () => {
    expect(decimalToCents(1240.1)).toBe(124_010);
  });

  it.each(['', 'abc', '1.234', '1,00', '1.2.3', 'NaN'])('refuses %s', (value) => {
    expect(decimalToCents(value)).toBeNull();
  });

  it('refuses an amount too large to hold exactly', () => {
    expect(decimalToCents('99999999999999999.99')).toBeNull();
  });
});

describe('maskAccountNumber', () => {
  it('leaves the bank’s own masking alone', () => {
    expect(maskAccountNumber('1340************8514')).toBe('1340************8514');
  });

  it('masks a full account number, keeping the ends the UI shows', () => {
    expect(maskAccountNumber('01340123450123458514')).toBe('0134************8514');
  });

  it('never echoes a short value in full', () => {
    expect(maskAccountNumber('8514')).toBe('****');
    expect(maskAccountNumber('12348514')).toBe('****8514');
  });
});

describe('lastFour', () => {
  it('reads the same four digits from a masked and a full account', () => {
    expect(lastFour('1340************8514')).toBe('8514');
    expect(lastFour('01340123450123458514')).toBe('8514');
  });
});

describe('padSudebanId', () => {
  it('pads to the four digits the port promises', () => {
    expect(padSudebanId('134')).toBe('0134');
    expect(padSudebanId(134)).toBe('0134');
    expect(padSudebanId('0134')).toBe('0134');
  });

  it('is null when the bank says nothing', () => {
    expect(padSudebanId(null)).toBeNull();
    expect(padSudebanId(undefined)).toBeNull();
    expect(padSudebanId('  ')).toBeNull();
  });
});

describe('venezuelaLocalToEpochSeconds', () => {
  it('reads a local instant as UTC−4', () => {
    // 2026-08-06 10:30:00 in Caracas is 14:30:00 UTC.
    expect(venezuelaLocalToEpochSeconds('2026-08-06', '10:30:00')).toBe(
      Date.parse('2026-08-06T14:30:00Z') / 1000,
    );
  });

  it('accepts a time without seconds', () => {
    expect(venezuelaLocalToEpochSeconds('2026-08-06', '10:30')).toBe(
      Date.parse('2026-08-06T14:30:00Z') / 1000,
    );
  });

  it('does not roll a late-evening payment into the next day', () => {
    // 23:30 local is 03:30 UTC the following day — the day the counter means is
    // still the sixth.
    expect(venezuelaLocalToEpochSeconds('2026-08-06', '23:30:00')).toBe(
      Date.parse('2026-08-07T03:30:00Z') / 1000,
    );
  });

  it.each([
    ['06/08/2026', '10:30:00'],
    ['2026-08-06', '10-30-00'],
    ['2026-08-06', '25:00:00'],
    ['2026-8-6', '10:30:00'],
    ['', ''],
  ])('refuses %s %s rather than guessing', (date, time) => {
    expect(venezuelaLocalToEpochSeconds(date, time)).toBeNull();
  });
});
