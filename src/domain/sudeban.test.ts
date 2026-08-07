import { describe, expect, it } from 'vitest';

import { findBank, isValidBankCode, SUDEBAN_BANKS, searchBanks } from './sudeban.ts';

describe('SUDEBAN_BANKS', () => {
  it('holds the 26 banks Sudeban lists', () => {
    expect(SUDEBAN_BANKS).toHaveLength(26);
  });

  it('is in ascending code order, which is the order the picker renders', () => {
    const codes = SUDEBAN_BANKS.map((bank) => bank.code);
    expect(codes).toEqual([...codes].sort());
  });

  it('has no duplicate code and no duplicate name', () => {
    expect(new Set(SUDEBAN_BANKS.map((b) => b.code)).size).toBe(SUDEBAN_BANKS.length);
    expect(new Set(SUDEBAN_BANKS.map((b) => b.name)).size).toBe(SUDEBAN_BANKS.length);
  });

  it('states every code as four digits, zero-padded, as the column stores it', () => {
    for (const bank of SUDEBAN_BANKS) {
      expect(bank.code).toMatch(/^\d{4}$/);
      expect(bank.name.trim()).toBe(bank.name);
      expect(bank.name).not.toBe('');
    }
  });
});

describe('findBank', () => {
  const table: ReadonlyArray<{ code: string; expected: string | null; why: string }> = [
    { code: '0102', expected: 'Banco de Venezuela', why: 'the first entry' },
    { code: '0134', expected: 'Banesco', why: 'the busiest' },
    { code: '0105', expected: 'Mercantil', why: 'mid-list' },
    { code: '0601', expected: 'Instituto Municipal de Crédito Popular', why: 'the last entry' },
    { code: '0178', expected: 'N58 Banco Digital', why: 'a recent one' },
    { code: '134', expected: null, why: 'not zero-padded: not a bank code' },
    { code: ' 0134', expected: null, why: 'a leading space is not trimmed away' },
    { code: '0134 ', expected: null, why: 'nor a trailing one' },
    { code: '0999', expected: null, why: 'four digits that belong to nobody' },
    { code: '0103', expected: null, why: 'a plausible gap in the range' },
    { code: '', expected: null, why: 'empty' },
    { code: 'banesco', expected: null, why: 'a name is not a code' },
  ];

  for (const { code, expected, why } of table) {
    it(`${JSON.stringify(code)} -> ${JSON.stringify(expected)} (${why})`, () => {
      expect(findBank(code)?.name ?? null).toBe(expected);
    });
  }

  it('agrees with isValidBankCode on every case', () => {
    for (const { code } of table) {
      expect(isValidBankCode(code)).toBe(findBank(code) !== null);
    }
    for (const bank of SUDEBAN_BANKS) {
      expect(isValidBankCode(bank.code)).toBe(true);
    }
  });
});

describe('searchBanks', () => {
  const codesFor = (query: string) => searchBanks(query).map((bank) => bank.code);

  const table: ReadonlyArray<{ query: string; expected: readonly string[]; why: string }> = [
    { query: 'banesco', expected: ['0134'], why: 'a full name, lowercase' },
    { query: 'Banesco', expected: ['0134'], why: 'the case a cashier types' },
    { query: 'BANESCO', expected: ['0134'], why: 'caps lock on' },
    { query: 'banes', expected: ['0134'], why: 'a prefix' },
    { query: 'esco', expected: ['0134'], why: 'an inner substring' },

    // accent-insensitive, which is the whole reason `fold` exists
    { query: 'credito', expected: ['0104', '0601'], why: 'no tilde on the keyboard' },
    { query: 'crédito', expected: ['0104', '0601'], why: 'and with one' },
    { query: 'caroni', expected: ['0128'], why: 'Caroní without its accent' },
    { query: 'agricola', expected: ['0166'], why: 'Agrícola without its accent' },
    { query: 'comun', expected: ['0151'], why: 'Común without its accent' },

    // by code
    { query: '0134', expected: ['0134'], why: 'the exact code' },
    { query: '134', expected: ['0134'], why: 'a code substring still finds it' },
    { query: '0601', expected: ['0601'], why: 'the outlier code' },

    // by name across several banks
    {
      query: 'banco de',
      expected: ['0102', '0163'],
      why: 'a multi-word fragment, and it also matches inside "Banco del Tesoro"',
    },
    { query: '100', expected: ['0156'], why: 'digits inside a name' },
    { query: 'mi banco', expected: ['0169'], why: 'a name that is a substring of nothing else' },

    // nothing
    { query: 'santander', expected: [], why: 'not a Venezuelan bank' },
    { query: '9999', expected: [], why: 'no such code' },
    { query: 'zzz', expected: [], why: 'no such name' },
  ];

  for (const { query, expected, why } of table) {
    it(`${JSON.stringify(query)} -> [${expected.join(', ')}] (${why})`, () => {
      expect(codesFor(query)).toEqual([...expected]);
    });
  }

  it('lists everything for an empty or whitespace query: that is the picker at rest', () => {
    expect(searchBanks('')).toHaveLength(26);
    expect(searchBanks('   ')).toHaveLength(26);
  });

  it('preserves Sudeban order in every result', () => {
    for (const query of ['banco', 'b', '01', 'a']) {
      const codes = codesFor(query);
      expect(codes).toEqual([...codes].sort());
    }
  });

  it('finds every bank by its own full name and by its own code', () => {
    for (const bank of SUDEBAN_BANKS) {
      expect(codesFor(bank.name)).toContain(bank.code);
      expect(codesFor(bank.code)).toContain(bank.code);
    }
  });
});
