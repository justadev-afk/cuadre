import { describe, expect, it } from 'vitest';

import {
  CURRENCY_BOLIVAR,
  formatBolivares,
  isSupportedCurrency,
  parseAmountToCents,
} from './money.ts';

describe('parseAmountToCents', () => {
  const table: ReadonlyArray<{ input: string | number; expected: number | null; why: string }> = [
    // what a bank actually sends
    { input: '1240.00', expected: 124000, why: 'the plain decimal Banesco returns' },
    { input: '1240', expected: 124000, why: 'no decimal part at all' },
    { input: '0.00', expected: 0, why: 'zero' },
    { input: '0.01', expected: 1, why: 'one cent' },
    { input: '0.1', expected: 10, why: 'one decimal is tenths, not hundredths' },
    { input: '1240.5', expected: 124050, why: 'a single decimal pads' },
    { input: '  1240.00  ', expected: 124000, why: 'surrounding whitespace' },

    // Venezuelan and US grouping
    { input: '1.240,00', expected: 124000, why: 'dot groups, comma decimals' },
    { input: '1.240', expected: 124000, why: 'a lone dot with three digits is grouping' },
    { input: '12.345.678,90', expected: 1234567890, why: 'several groups' },
    { input: '1,240.00', expected: 124000, why: 'US grouping: the last separator decides' },
    { input: '1,240', expected: 124000, why: 'a lone comma with three digits is grouping' },
    { input: '999,99', expected: 99999, why: 'a comma with two digits is a decimal' },
    { input: '0.100', expected: 10, why: 'no grouped number starts with zero: decimal' },

    // the float traps
    { input: 0.1 + 0.2, expected: null, why: '0.30000000000000004 is not an amount' },
    { input: 1.005, expected: null, why: 'the classic round-half-up trap is refused' },
    {
      input: '1.005',
      expected: 100500,
      why: 'as a *string* it is grouped, exactly as "1.240" is — numbers cannot group',
    },
    { input: 0.07, expected: 7, why: 'a double that prints exactly still parses' },
    { input: 1240.0, expected: 124000, why: 'trailing zeros vanish before we see it' },
    { input: '1240.005', expected: null, why: 'half a cent is refused, not rounded' },
    { input: '1240.004', expected: null, why: 'refused even where rounding would drop it' },
    { input: '1240.000', expected: 124000, why: 'a third decimal of zero is still exact' },
    { input: 8.16, expected: 816, why: '8.16 * 100 is 815.9999999999999 in floating point' },
    { input: '8.16', expected: 816, why: 'and the string form agrees, digit for digit' },
    { input: 1e21, expected: null, why: 'exponential notation is not an amount' },
    { input: 1e-7, expected: null, why: 'and neither is the small end' },
    { input: Number.NaN, expected: null, why: 'NaN' },
    { input: Number.POSITIVE_INFINITY, expected: null, why: 'Infinity' },
    { input: Number.MAX_SAFE_INTEGER, expected: null, why: 'times 100 it stops being exact' },

    // signs
    { input: '-1240.00', expected: -124000, why: 'a debit keeps its sign' },
    { input: -1240, expected: -124000, why: 'a negative number' },
    { input: '+1240.00', expected: 124000, why: 'an explicit plus' },

    // refusals
    { input: '', expected: null, why: 'empty' },
    { input: '   ', expected: null, why: 'whitespace only' },
    { input: 'abc', expected: null, why: 'letters' },
    { input: 'Bs 1.240,00', expected: null, why: 'the currency belongs to formatting' },
    { input: '1 240,00', expected: null, why: 'an inner space is not a separator we accept' },
    { input: '1240.', expected: null, why: 'a truncated string' },
    { input: '.50', expected: null, why: 'no whole part' },
    { input: '1,240,00', expected: null, why: 'not a number in any locale' },
    { input: '1.240,50.00', expected: null, why: 'three separators' },
    { input: '--1240', expected: null, why: 'two signs' },
    { input: '1240.00.00', expected: null, why: 'a malformed group' },
    { input: '1..240', expected: null, why: 'a doubled separator' },
    { input: ',', expected: null, why: 'a separator alone' },
  ];

  for (const { input, expected, why } of table) {
    it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)} (${why})`, () => {
      expect(parseAmountToCents(input)).toBe(expected);
    });
  }

  it('never returns a non-integer', () => {
    for (const { input } of table) {
      const cents = parseAmountToCents(input);
      if (cents !== null) expect(Number.isSafeInteger(cents)).toBe(true);
    }
  });

  it('agrees with itself across the two grouping conventions', () => {
    expect(parseAmountToCents('1.240,00')).toBe(parseAmountToCents('1240.00'));
    expect(parseAmountToCents('1,240.00')).toBe(parseAmountToCents('1240.00'));
  });

  it('reads a three-digit tail as grouping in every string, or in none', () => {
    // The rule cannot be applied selectively: if '1.240' is a thousand, so is
    // '1.005'. Anything else would make the meaning depend on the digits.
    for (const tail of ['000', '005', '240', '999']) {
      expect(parseAmountToCents(`1.${tail}`)).toBe(Number(`1${tail}`) * 100);
    }
  });
});

describe('formatBolivares', () => {
  const table: ReadonlyArray<{ cents: number; expected: string; why: string }> = [
    { cents: 124000, expected: 'Bs 1.240,00', why: 'the reference case' },
    { cents: 0, expected: 'Bs 0,00', why: 'zero still shows both decimals' },
    { cents: 5, expected: 'Bs 0,05', why: 'under ten cents pads' },
    { cents: 50, expected: 'Bs 0,50', why: 'under a bolívar' },
    { cents: 100, expected: 'Bs 1,00', why: 'exactly one bolívar' },
    { cents: 99, expected: 'Bs 0,99', why: 'just under one' },
    { cents: 99999, expected: 'Bs 999,99', why: 'the last value with no grouping' },
    { cents: 100000, expected: 'Bs 1.000,00', why: 'the first grouped value' },
    { cents: 1234567890, expected: 'Bs 12.345.678,90', why: 'two group separators' },
    { cents: 100000000, expected: 'Bs 1.000.000,00', why: 'a round million' },
    { cents: -124000, expected: 'Bs -1.240,00', why: 'the sign sits with the number' },
    { cents: -5, expected: 'Bs -0,05', why: 'a small negative' },
    { cents: Number.NaN, expected: 'Bs 0,00', why: 'display never renders NaN at a counter' },
    { cents: 1240.7, expected: 'Bs 12,40', why: 'a stray float is truncated, never rounded up' },
  ];

  for (const { cents, expected, why } of table) {
    it(`${cents} -> ${JSON.stringify(expected)} (${why})`, () => {
      expect(formatBolivares(cents)).toBe(expected);
    });
  }

  it('round-trips through parseAmountToCents for every grouped value', () => {
    for (const cents of [0, 1, 99, 100, 99999, 124000, 1234567890]) {
      const shown = formatBolivares(cents).replace('Bs ', '');
      expect(parseAmountToCents(shown)).toBe(cents);
    }
  });
});

describe('isSupportedCurrency', () => {
  const table: ReadonlyArray<{ raw: string; expected: boolean; why: string }> = [
    { raw: 'BS', expected: true, why: 'canonical' },
    { raw: 'BS ', expected: true, why: "the trailing space Banesco sends in 'BS '" },
    { raw: ' bs ', expected: true, why: 'trimmed and upper-cased' },
    { raw: 'Bs', expected: true, why: 'mixed case' },
    { raw: '\tBS\n', expected: true, why: 'any whitespace' },
    { raw: 'USD', expected: false, why: 'dollars are not settled here' },
    { raw: 'VES', expected: false, why: 'the ISO code is not what the bank sends' },
    { raw: 'BSS', expected: false, why: 'an old redenomination code' },
    { raw: 'B S', expected: false, why: 'an inner space is not trimmed away' },
    { raw: '', expected: false, why: 'empty' },
  ];

  for (const { raw, expected, why } of table) {
    it(`${JSON.stringify(raw)} -> ${expected} (${why})`, () => {
      expect(isSupportedCurrency(raw)).toBe(expected);
    });
  }

  it('exposes the canonical code it compares against', () => {
    expect(CURRENCY_BOLIVAR).toBe('BS');
    expect(isSupportedCurrency(CURRENCY_BOLIVAR)).toBe(true);
  });
});
