import { describe, expect, it } from 'vitest';

import { isValidRif, isValidSlug, normaliseRif, normaliseSlug, TEST_RIF } from './company.ts';

describe('normaliseSlug', () => {
  const table: ReadonlyArray<{ raw: string; expected: string | null; why: string }> = [
    { raw: 'la-espiga', expected: 'la-espiga', why: 'already canonical' },
    { raw: 'La Espiga', expected: 'la-espiga', why: 'spaces and case' },
    { raw: 'Panadería La Espiga', expected: 'panaderia-la-espiga', why: 'accents fold' },
    { raw: 'Bodegón Ñandú', expected: 'bodegon-nandu', why: 'n-tilde keeps its letter' },
    { raw: 'la_espiga', expected: 'la-espiga', why: 'underscore is a separator' },
    { raw: 'La  Espiga', expected: 'la-espiga', why: 'a run collapses to one hyphen' },
    { raw: '  la-espiga  ', expected: 'la-espiga', why: 'surrounding whitespace' },
    { raw: '-la-espiga-', expected: 'la-espiga', why: 'edge hyphens are stripped' },
    { raw: 'La Espiga, C.A.', expected: 'la-espiga-c-a', why: 'punctuation separates' },
    { raw: 'abc', expected: 'abc', why: 'exactly the minimum' },
    { raw: 'ab', expected: null, why: 'one under the minimum' },
    { raw: 'a-b', expected: 'a-b', why: 'three chars including a hyphen' },
    { raw: 'a'.repeat(32), expected: 'a'.repeat(32), why: 'exactly the maximum' },
    { raw: 'a'.repeat(33), expected: null, why: 'one over the maximum: never truncated' },
    { raw: '', expected: null, why: 'empty' },
    { raw: '---', expected: null, why: 'nothing but separators' },
    { raw: '   ', expected: null, why: 'nothing but whitespace' },
    { raw: '你好世界', expected: null, why: 'no ASCII survives' },
    { raw: '2024', expected: '2024', why: 'all digits is a legal slug' },
    { raw: 'café', expected: 'cafe', why: 'accent fold shortens to the minimum' },
  ];

  for (const { raw, expected, why } of table) {
    it(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)} (${why})`, () => {
      expect(normaliseSlug(raw)).toBe(expected);
    });
  }

  it('is idempotent: normalising a canonical slug changes nothing', () => {
    for (const { raw } of table) {
      const once = normaliseSlug(raw);
      if (once !== null) expect(normaliseSlug(once)).toBe(once);
    }
  });
});

describe('isValidSlug', () => {
  const table: ReadonlyArray<{ slug: string; expected: boolean; why: string }> = [
    { slug: 'la-espiga', expected: true, why: 'canonical' },
    { slug: 'abc', expected: true, why: 'minimum length' },
    { slug: 'a'.repeat(32), expected: true, why: 'maximum length' },
    { slug: 'a1-b2-c3', expected: true, why: 'digits inside groups' },
    { slug: 'ab', expected: false, why: 'too short' },
    { slug: 'a'.repeat(33), expected: false, why: 'too long' },
    { slug: 'La-Espiga', expected: false, why: 'uppercase is not canonical' },
    { slug: 'la--espiga', expected: false, why: 'double hyphen' },
    { slug: '-la-espiga', expected: false, why: 'leading hyphen' },
    { slug: 'la-espiga-', expected: false, why: 'trailing hyphen' },
    { slug: 'la espiga', expected: false, why: 'space' },
    { slug: 'la_espiga', expected: false, why: 'underscore' },
    { slug: 'la.espiga', expected: false, why: 'dot' },
    { slug: 'panadería', expected: false, why: 'accented letter' },
    { slug: '---', expected: false, why: 'only hyphens' },
    { slug: '', expected: false, why: 'empty' },
  ];

  for (const { slug, expected, why } of table) {
    it(`${JSON.stringify(slug)} -> ${expected} (${why})`, () => {
      expect(isValidSlug(slug)).toBe(expected);
    });
  }
});

describe('normaliseRif', () => {
  const table: ReadonlyArray<{ raw: string; expected: string | null; why: string }> = [
    { raw: 'J-40123456-7', expected: 'J-40123456-7', why: 'already canonical' },
    { raw: 'J401234567', expected: 'J-40123456-7', why: 'unpunctuated' },
    { raw: 'j401234567', expected: 'J-40123456-7', why: 'lowercase letter' },
    { raw: ' J-40123456-7 ', expected: 'J-40123456-7', why: 'surrounding whitespace' },
    { raw: 'J 40123456 7', expected: 'J-40123456-7', why: 'spaces instead of hyphens' },
    { raw: 'J.401.234.567', expected: 'J-40123456-7', why: 'dots as separators' },
    { raw: 'V-12345678-1', expected: 'V-12345678-1', why: 'a natural person' },
    { raw: 'G-200000104', expected: 'G-20000010-4', why: 'a government body' },
    { raw: 'E812345675', expected: 'E-81234567-5', why: 'a foreign resident' },
    { raw: 'P401234567', expected: 'P-40123456-7', why: 'a passport class' },
    { raw: 'J4012345678', expected: 'J-401234567-8', why: 'a nine-digit body' },
    { raw: TEST_RIF, expected: TEST_RIF, why: 'the test RIF is already canonical' },
    { raw: 'J-0000000-0', expected: TEST_RIF, why: 'all zeros, one short: still the test RIF' },
    { raw: 'J00000000', expected: TEST_RIF, why: 'eight zeros, unpunctuated' },
    { raw: 'J-0000000000', expected: TEST_RIF, why: 'a field filled with zeros folds too' },
    { raw: 'V-00000000-0', expected: TEST_RIF, why: 'one test RIF, and it is a J' },
    { raw: 'J-0000000-1', expected: null, why: 'not all zeros: a short body is short' },
    { raw: 'J-4012345-6', expected: null, why: 'body is short of eight digits' },
    { raw: 'J40123456789', expected: null, why: 'too many digits' },
    { raw: 'X401234567', expected: null, why: 'X is not a RIF class' },
    { raw: '401234567', expected: null, why: 'no class letter' },
    { raw: 'JJ40123456', expected: null, why: 'two letters' },
    { raw: 'J4012345A7', expected: null, why: 'a letter inside the body' },
    { raw: '', expected: null, why: 'empty' },
  ];

  for (const { raw, expected, why } of table) {
    it(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)} (${why})`, () => {
      expect(normaliseRif(raw)).toBe(expected);
    });
  }
});

describe('isValidRif', () => {
  /**
   * The three real rows are the ones that pin the letter table: they are RIFs
   * printed on public invoices, and only V=1 E=2 J=3 P=4 G=5 reproduces all
   * three check digits. If this block ever goes red, the letter values were
   * changed, not the algorithm.
   */
  const realWorld: ReadonlyArray<{ rif: string; who: string }> = [
    { rif: 'J-07013380-5', who: 'Banesco' },
    { rif: 'J-00002961-0', who: 'Mercantil' },
    { rif: 'J-00002967-9', who: 'Provincial' },
  ];

  for (const { rif, who } of realWorld) {
    it(`accepts ${rif} (${who})`, () => {
      expect(isValidRif(rif)).toBe(true);
    });

    it(`rejects ${rif} with every other check digit (${who})`, () => {
      const stated = Number(rif.slice(-1));
      for (let digit = 0; digit <= 9; digit++) {
        if (digit === stated) continue;
        expect(isValidRif(`${rif.slice(0, -1)}${digit}`)).toBe(false);
      }
    });
  }

  const table: ReadonlyArray<{ rif: string; expected: boolean; why: string }> = [
    { rif: 'V-12345678-1', expected: true, why: 'V maps to 1' },
    { rif: 'E-81234567-5', expected: true, why: 'E maps to 2' },
    { rif: 'P-40123456-5', expected: true, why: 'P maps to 4' },
    { rif: 'G-20000010-4', expected: true, why: 'G maps to 5' },
    { rif: 'J-00002961-0', expected: true, why: 'a remainder of 1 collapses to 0' },
    { rif: TEST_RIF, expected: true, why: 'the test RIF: mod-11 over a J and zeros really is 0' },
    { rif: 'V-00000000-0', expected: false, why: 'the test RIF is not exempt, it just adds up' },
    { rif: 'J-40123456-7', expected: false, why: 'plausible shape, wrong check digit' },
    { rif: 'J-40123456-9', expected: true, why: 'the same body with its real check digit' },
    { rif: 'J-07013830-5', expected: false, why: 'two digits transposed' },
    { rif: 'J-07013380-4', expected: false, why: 'check digit off by one' },
    { rif: 'J401338 05', expected: false, why: 'not canonical: normaliseRif runs first' },
    { rif: 'J07013380-5', expected: false, why: 'missing the first hyphen' },
    { rif: 'j-07013380-5', expected: false, why: 'lowercase is not canonical' },
    { rif: 'X-07013380-5', expected: false, why: 'not a RIF class' },
    { rif: '', expected: false, why: 'empty' },
  ];

  for (const { rif, expected, why } of table) {
    it(`${JSON.stringify(rif)} -> ${expected} (${why})`, () => {
      expect(isValidRif(rif)).toBe(expected);
    });
  }

  it('accepts exactly one check digit for any given body', () => {
    const bodies = ['07013380', '00002961', '12345678', '99999999', '00000000'];
    for (const letter of ['J', 'G', 'V', 'E', 'P']) {
      for (const body of bodies) {
        const accepted = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) =>
          isValidRif(`${letter}-${body}-${d}`),
        );
        expect(accepted).toHaveLength(1);
      }
    }
  });
});
