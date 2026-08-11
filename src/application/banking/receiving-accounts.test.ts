import { describe, expect, it } from 'vitest';

import type { BankReceivingAccountRule } from '../ports/bank-gateway.ts';
import { checkReceivingAccount, keepValidReceivingAccounts } from './receiving-accounts.ts';

/** Banesco's, but nothing below reads the number 20 or the string '0134'. */
const BANESCO: BankReceivingAccountRule = {
  digits: 20,
  prefix: '0134',
  label: 'Cuentas que reciben transferencias',
  placeholder: '01340804108041005394',
};

/** A bank with shorter numbers and no prefix at all — the rule is data. */
const OTHER: BankReceivingAccountRule = {
  digits: 10,
  prefix: null,
  label: 'Cuentas receptoras',
  placeholder: '1234567890',
};

const GOOD = '01340804108041005394';

describe('checkReceivingAccount', () => {
  const table: ReadonlyArray<[BankReceivingAccountRule, string, string, string]> = [
    [BANESCO, GOOD, 'ok', 'the number the bank answers on'],
    [BANESCO, '0134 0804 1080 4100 5394', 'ok', 'typed with the spaces of a bank app'],
    [BANESCO, '0134-0804-1080-4100-5394', 'ok', 'or with dashes'],
    [BANESCO, '013408041080410053', 'wrong_length', 'two digits short'],
    [BANESCO, `${GOOD}9`, 'wrong_length', 'one too many'],
    [BANESCO, '01050804108041005394', 'wrong_bank', 'another bank’s number, right length'],
    [OTHER, '1234567890', 'ok', 'a bank with ten digits and no prefix'],
    [OTHER, GOOD, 'wrong_length', 'and it refuses the twenty-digit one'],
  ];

  for (const [rule, raw, expected, why] of table) {
    it(`${expected} — ${why}`, () => {
      const result = checkReceivingAccount(rule, raw);
      expect(result.ok ? 'ok' : result.reason).toBe(expected);
    });
  }

  it('strips the separators before storing, so one account has one spelling', () => {
    const result = checkReceivingAccount(BANESCO, '0134 0804 1080 4100 5394');
    expect(result.ok && result.account).toBe(GOOD);
  });

  it('refuses the same account twice, however it was punctuated', () => {
    const result = checkReceivingAccount(BANESCO, '0134-0804-1080-4100-5394', [GOOD]);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toBe('duplicate');
  });
});

describe('keepValidReceivingAccounts', () => {
  it('keeps what the bank could be asked with, in order, deduped', () => {
    expect(
      keepValidReceivingAccounts(BANESCO, [GOOD, 'nonsense', GOOD, '01340000000000005258']),
    ).toEqual([GOOD, '01340000000000005258']);
  });

  it('keeps nothing for a bank that never asks for one', () => {
    expect(keepValidReceivingAccounts(null, [GOOD])).toEqual([]);
  });
});
