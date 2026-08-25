import { describe, expect, it } from 'vitest';

import {
  askedPayer,
  type CustomPayerBank,
  findPayerBank,
  isCustomPayerBankCode,
  isSudebanCode,
  payerBankCatalogue,
  payerBankName,
  payerWasRewritten,
  toPayerBank,
} from './payer-bank.ts';
import { SUDEBAN_BANKS } from './sudeban.ts';

const UBII: CustomPayerBank = {
  code: 'ubii',
  name: 'Ubii',
  targetBankId: '0104',
  targetPhone: '+584142698301',
  status: 'active',
};

/** A brand that only rewrites the bank: the cashier's phone is the one asked. */
const PASSTHROUGH: CustomPayerBank = { ...UBII, code: 'otra', name: 'Otra', targetPhone: null };

describe('a custom code is never a Sudeban code', () => {
  const cases: readonly [string, boolean][] = [
    ['ubii', true],
    ['mi-banco-2', true],
    ['ab', true],
    // Four digits is the shape the other catalogue owns, and a leading letter
    // is what makes that impossible to write here.
    ['0104', false],
    ['0134', false],
    ['1abc', false],
    ['a', false],
    ['Ubii', false],
    ['ubii ', false],
    ['ubii_x', false],
    ['', false],
    [`a${'b'.repeat(24)}`, false],
  ];

  for (const [code, valid] of cases) {
    it(`${JSON.stringify(code)} → ${valid}`, () => {
      expect(isCustomPayerBankCode(code)).toBe(valid);
      // The two are mutually exclusive by construction, which is the whole
      // reason `findPayerBank` needs no precedence rule.
      if (valid) expect(isSudebanCode(code)).toBe(false);
    });
  }
});

describe('the catalogue', () => {
  it('is Sudeban in Sudeban order, then the custom brands', () => {
    const catalogue = payerBankCatalogue([toPayerBank(UBII)]);
    expect(catalogue).toHaveLength(SUDEBAN_BANKS.length + 1);
    expect(catalogue[0]).toEqual({
      code: '0102',
      name: 'Banco de Venezuela',
      sudebanCode: '0102',
      suggestedPhone: null,
    });
    // A brand is printed under the code it is really asked with, not its slug:
    // four digits are what a cashier recognises, and `ubii` is not.
    expect(catalogue.at(-1)).toEqual({
      code: 'ubii',
      name: 'Ubii',
      sudebanCode: '0104',
      suggestedPhone: '+584142698301',
    });
  });

  it('resolves either half, and prints the code when neither knows it', () => {
    const custom = [toPayerBank(UBII)];
    expect(findPayerBank('0134', custom)?.name).toBe('Banesco');
    expect(findPayerBank('0134', custom)?.sudebanCode).toBe('0134');
    expect(findPayerBank('ubii', custom)?.name).toBe('Ubii');
    // Asked under Venezolano de Crédito, and that is the code a picker prints.
    expect(findPayerBank('ubii', custom)?.sudebanCode).toBe('0104');
    expect(findPayerBank('ubii', [])).toBeNull();
    expect(payerBankName('ubii', [])).toBe('ubii');
    // A Sudeban code needs no list at all, which is why a listing without one
    // still names twenty-six of the twenty-seven.
    expect(payerBankName('0172', [])).toBe('Bancamiga');
  });
});

describe('what the bank is actually asked with', () => {
  const typed = '+584143125566';

  it('is the pick itself for a Sudeban bank', () => {
    const asked = askedPayer({ sourceBankId: '0134', payerPhone: typed, custom: null });
    expect(asked).toEqual({ sourceBankId: '0134', payerPhone: typed });
    expect(payerWasRewritten({ sourceBankId: '0134', payerPhone: typed }, asked)).toBe(false);
  });

  it('rewrites both halves for a brand that carries a phone', () => {
    const asked = askedPayer({ sourceBankId: 'ubii', payerPhone: typed, custom: UBII });
    expect(asked).toEqual({ sourceBankId: '0104', payerPhone: '+584142698301' });
    expect(payerWasRewritten({ sourceBankId: 'ubii', payerPhone: typed }, asked)).toBe(true);
  });

  it('keeps the typed phone for a brand that carries none', () => {
    const asked = askedPayer({ sourceBankId: 'otra', payerPhone: typed, custom: PASSTHROUGH });
    expect(asked).toEqual({ sourceBankId: '0104', payerPhone: typed });
    // Still a rewrite: the bank code changed, and the row has to say so.
    expect(payerWasRewritten({ sourceBankId: 'otra', payerPhone: typed }, asked)).toBe(true);
  });

  it('never invents a phone for a kind that carries none', () => {
    // A transferencia sends no phone at all, and substituting into a field that
    // is not on the wire would be a fact recorded for nobody.
    const asked = askedPayer({ sourceBankId: 'ubii', payerPhone: null, custom: UBII });
    expect(asked).toEqual({ sourceBankId: '0104', payerPhone: null });
  });
});
