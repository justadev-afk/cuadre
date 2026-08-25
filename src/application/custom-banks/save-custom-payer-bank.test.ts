import { describe, expect, it } from 'vitest';

import type {
  CustomPayerBankEdit,
  NewCustomPayerBank,
} from '../../adapters/d1/custom-payer-bank.repository.ts';
import { fixedClock } from '../../shared/clock.ts';
import {
  makeSaveCustomPayerBank,
  type SaveCustomPayerBankInput,
} from './save-custom-payer-bank.ts';

const NOW = 1_770_000_000;

const INPUT: SaveCustomPayerBankInput = {
  code: 'ubii',
  name: 'Ubii',
  targetBankId: '0104',
  targetPhone: '0414-2698301',
  status: 'active',
  creating: true,
};

function harness(taken: readonly string[] = [], existing: readonly string[] = ['ubii']) {
  const inserts: NewCustomPayerBank[] = [];
  const updates: (CustomPayerBankEdit & { code: string })[] = [];
  return {
    inserts,
    updates,
    save: makeSaveCustomPayerBank({
      customBanks: {
        async insert(input) {
          if (taken.includes(input.code)) return 'code_taken';
          inserts.push(input);
          return 'inserted';
        },
        async update(code, input) {
          if (!existing.includes(code)) return 'not_found';
          updates.push({ code, ...input });
          return 'updated';
        },
      },
      clock: fixedClock(NOW),
    }),
  };
}

describe('creating', () => {
  it('stores the phone as E.164, whatever the admin pasted', async () => {
    const { save, inserts } = harness();
    expect(await save(INPUT)).toEqual({ ok: true, value: null });
    expect(inserts[0]).toEqual({
      code: 'ubii',
      name: 'Ubii',
      targetBankId: '0104',
      targetPhone: '+584142698301',
      status: 'active',
      at: NOW,
    });
  });

  it('reads an empty phone as "ask with the one the cashier typed"', async () => {
    const { save, inserts } = harness();
    expect(await save({ ...INPUT, targetPhone: '   ' })).toEqual({ ok: true, value: null });
    expect(inserts[0]?.targetPhone).toBeNull();
  });

  it('lower-cases the code, so one brand is never filed twice', async () => {
    const { save, inserts } = harness();
    await save({ ...INPUT, code: 'UBII' });
    expect(inserts[0]?.code).toBe('ubii');
  });

  it('reports a collision rather than overwriting the brand a history names', async () => {
    const { save } = harness(['ubii']);
    expect(await save(INPUT)).toEqual({ ok: false, error: 'code_taken' });
  });
});

describe('what it refuses, and why', () => {
  const cases: readonly [string, Partial<SaveCustomPayerBankInput>, string][] = [
    // Four digits is the other catalogue's shape: a code like this would be
    // resolved from Sudeban's table and never reach the row it named.
    ['a four-digit code', { code: '0104' }, 'invalid_code'],
    ['a code with a space', { code: 'mi banco' }, 'invalid_code'],
    ['no name', { name: '  ' }, 'invalid_name'],
    ['a name nobody could read in a dropdown', { name: 'x'.repeat(41) }, 'invalid_name'],
    // A code Sudeban does not list is a question no bank answers: the search
    // matches on it, so a wrong one comes back empty in front of a customer.
    ['a target bank Sudeban does not list', { targetBankId: '9999' }, 'invalid_target_bank'],
    ['a target that is a custom code', { targetBankId: 'ubii' }, 'invalid_target_bank'],
    ['a phone with no pago móvil behind it', { targetPhone: '0212-5551234' }, 'invalid_phone'],
  ];

  for (const [what, override, error] of cases) {
    it(`refuses ${what}`, async () => {
      const { save, inserts } = harness();
      expect(await save({ ...INPUT, ...override })).toEqual({ ok: false, error });
      expect(inserts).toHaveLength(0);
    });
  }
});

describe('editing', () => {
  it('updates the row under its code, which it never changes', async () => {
    const { save, updates } = harness();
    expect(await save({ ...INPUT, creating: false, name: 'Ubii Pay', status: 'disabled' })).toEqual(
      { ok: true, value: null },
    );
    expect(updates[0]).toEqual({
      code: 'ubii',
      name: 'Ubii Pay',
      targetBankId: '0104',
      targetPhone: '+584142698301',
      status: 'disabled',
      at: NOW,
    });
  });

  it('says so when the row is gone', async () => {
    const { save } = harness([], []);
    expect(await save({ ...INPUT, creating: false })).toEqual({ ok: false, error: 'not_found' });
  });
});
