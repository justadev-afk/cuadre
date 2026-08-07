import { describe, expect, it } from 'vitest';

import type {
  BankAccount,
  BankAccountWriteFailure,
} from '../../adapters/d1/bank-account.repository.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { makeRemoveBankAccount } from './remove-bank-account.ts';

const SEALED = { ciphertext: new Uint8Array([1]), iv: new Uint8Array([2]), keyVersion: 1 };

function account(overrides: Partial<BankAccount> = {}): BankAccount {
  return {
    id: 'account-1',
    companyId: 'la-espiga',
    bank: 'banesco',
    environment: 'production',
    clientIdLast6: 'client',
    accountNumber: SEALED,
    credentials: [
      { credKey: 'main', usage: 'operate', clientIdLast6: 'client', credentials: SEALED },
    ],
    accountLast4: '8514',
    accountType: 'Corriente',
    holderId: 'J-12345678-9',
    verifiedAt: 1_770_000_000,
    credsExpireAt: null,
    status: 'active',
    createdAt: 1_760_000_000,
    ...overrides,
  };
}

function fakeAccounts(stored: BankAccount | null) {
  const removed: string[] = [];
  return {
    removed,
    accounts: {
      async findById(id: string) {
        return stored !== null && stored.id === id ? stored : null;
      },
      async remove(id: string): Promise<Result<BankAccount, BankAccountWriteFailure>> {
        removed.push(id);
        return stored === null ? err('not_found') : ok({ ...stored, status: 'removed' });
      },
    },
  };
}

describe('remove bank account', () => {
  it('sets the status and never deletes the row', async () => {
    const { accounts, removed } = fakeAccounts(account());
    const removeBankAccount = makeRemoveBankAccount({ accounts });

    const result = await removeBankAccount({ companyId: 'la-espiga', accountId: 'account-1' });

    expect(result).toMatchObject({ ok: true, value: { id: 'account-1', status: 'removed' } });
    expect(removed).toEqual(['account-1']);
  });

  it("reads another merchant's account as not found, and does not touch it", async () => {
    const { accounts, removed } = fakeAccounts(account({ companyId: 'otra-empresa' }));
    const removeBankAccount = makeRemoveBankAccount({ accounts });

    // Anything else would let this endpoint enumerate other merchants' ids.
    expect(await removeBankAccount({ companyId: 'la-espiga', accountId: 'account-1' })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(removed).toEqual([]);
  });

  it('answers not_found for an account that does not exist', async () => {
    const { accounts } = fakeAccounts(null);
    const removeBankAccount = makeRemoveBankAccount({ accounts });

    expect(await removeBankAccount({ companyId: 'la-espiga', accountId: 'ghost' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('answers with the view, never the sealed envelopes', async () => {
    const { accounts } = fakeAccounts(account());
    const removeBankAccount = makeRemoveBankAccount({ accounts });

    const result = await removeBankAccount({ companyId: 'la-espiga', accountId: 'account-1' });

    expect(result.ok && 'credentials' in result.value).toBe(false);
    expect(result.ok && 'accountNumber' in result.value).toBe(false);
  });
});
