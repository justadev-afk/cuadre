import { describe, expect, it } from 'vitest';

import { formatPhoneForDisplay, normalisePhone, VENEZUELAN_MOBILE_PREFIXES } from './phone.ts';

describe('normalisePhone', () => {
  const table: ReadonlyArray<{ raw: string; expected: string | null; why: string }> = [
    // the four forms a number is written in
    { raw: '0414-3125566', expected: '584143125566', why: 'as a customer reads it aloud' },
    { raw: '04143125566', expected: '584143125566', why: 'unpunctuated national' },
    { raw: '+58 414 3125566', expected: '584143125566', why: 'international, spaced' },
    { raw: '584143125566', expected: '584143125566', why: 'already canonical' },
    { raw: '4143125566', expected: '584143125566', why: 'the trunk zero omitted' },

    // punctuation is noise
    { raw: '+58 (414) 312-5566', expected: '584143125566', why: 'parentheses and hyphens' },
    { raw: '  0414 312 55 66  ', expected: '584143125566', why: 'whitespace anywhere' },
    { raw: '0414.312.5566', expected: '584143125566', why: 'dots' },
    { raw: '+58-414-3125566', expected: '584143125566', why: 'hyphens after the plus' },

    // every operator that carries pago móvil
    { raw: '04123125566', expected: '584123125566', why: '0412' },
    { raw: '04143125566', expected: '584143125566', why: '0414' },
    { raw: '04163125566', expected: '584163125566', why: '0416' },
    { raw: '04243125566', expected: '584243125566', why: '0424' },
    { raw: '04263125566', expected: '584263125566', why: '0426' },

    // and the ones that do not
    { raw: '02123125566', expected: null, why: '0212 is a Caracas landline' },
    { raw: '04133125566', expected: null, why: '0413 is not an operator' },
    { raw: '04253125566', expected: null, why: '0425 is not an operator' },
    { raw: '04153125566', expected: null, why: '0415 is not an operator' },
    { raw: '585123125566', expected: null, why: 'valid country code, invalid operator' },

    // wrong lengths
    { raw: '0414312556', expected: null, why: 'one digit short' },
    { raw: '041431255667', expected: null, why: 'one digit long' },
    { raw: '5841431255', expected: null, why: 'country code with a short national part' },
    { raw: '00584143125566', expected: null, why: 'the 00 international prefix is not a form' },
    { raw: '+1 414 3125566', expected: null, why: 'another country code of the same length' },
    { raw: '414312556', expected: null, why: 'nine digits' },
    { raw: '', expected: null, why: 'empty' },
    { raw: 'not a phone number', expected: null, why: 'no digits at all' },
    { raw: '0414-ABC-5566', expected: null, why: 'letters leave too few digits' },
  ];

  for (const { raw, expected, why } of table) {
    it(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)} (${why})`, () => {
      expect(normalisePhone(raw)).toBe(expected);
    });
  }

  it('is idempotent', () => {
    for (const { raw } of table) {
      const once = normalisePhone(raw);
      if (once !== null) expect(normalisePhone(once)).toBe(once);
    }
  });

  it('accepts exactly the five listed operator prefixes and nothing else', () => {
    for (let prefix = 400; prefix <= 429; prefix++) {
      const accepted = normalisePhone(`0${prefix}3125566`) !== null;
      expect(accepted).toBe(VENEZUELAN_MOBILE_PREFIXES.includes(`0${prefix}`));
    }
  });
});

describe('formatPhoneForDisplay', () => {
  const table: ReadonlyArray<{ normalised: string; expected: string; why: string }> = [
    { normalised: '584143125566', expected: '0414-3125566', why: 'the reference case' },
    { normalised: '584123125566', expected: '0412-3125566', why: 'another operator' },
    { normalised: '584263125566', expected: '0426-3125566', why: 'and another' },
    { normalised: '0414-3125566', expected: '0414-3125566', why: 'not canonical: passed through' },
    { normalised: '', expected: '', why: 'empty passes through rather than throwing' },
    { normalised: '58414312556', expected: '58414312556', why: 'too short: passed through' },
  ];

  for (const { normalised, expected, why } of table) {
    it(`${JSON.stringify(normalised)} -> ${JSON.stringify(expected)} (${why})`, () => {
      expect(formatPhoneForDisplay(normalised)).toBe(expected);
    });
  }

  it('round-trips every operator', () => {
    for (const prefix of VENEZUELAN_MOBILE_PREFIXES) {
      const typed = `${prefix}-3125566`;
      const stored = normalisePhone(typed);
      expect(stored).not.toBeNull();
      expect(formatPhoneForDisplay(stored ?? '')).toBe(typed);
    }
  });
});
