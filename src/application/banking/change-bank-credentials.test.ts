import { describe, expect, it } from 'vitest';

import type {
  BankAccount,
  BankAccountWriteFailure,
} from '../../adapters/d1/bank-account.repository.ts';
import { fixedClock } from '../../shared/clock.ts';
import { type Sealed, seal, unseal } from '../../shared/crypto.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { BankFailure, BankGateway, BankSession } from '../ports/bank-gateway.ts';
import type { AccountCredentials } from './account-credentials.ts';
import { makeChangeBankCredentials } from './change-bank-credentials.ts';

const NOW = 1_770_000_000;
const CREDS_KEY = 'a-test-master-key-of-at-least-32-bytes';
const ACCOUNT_NUMBER = '01340123450123458514';

/** The secret already sealed on the row — it is never read back to the caller. */
const OLD: AccountCredentials = { main: { clientId: 'old-client-000000', clientSecret: 'old' } };
/** What the merchant types in the modal. */
const NEW: AccountCredentials = { main: { clientId: 'new-client-999999', clientSecret: 'new' } };

const SESSION: BankSession = { bank: 'banesco', environment: 'production', correlationId: 'c1' };

async function account(overrides: Partial<BankAccount> = {}): Promise<BankAccount> {
  return {
    id: 'account-1',
    companyId: 'la-espiga',
    bank: 'banesco',
    environment: 'production',
    credentials: await seal(CREDS_KEY, OLD),
    clientIdLast6: '000000',
    accountNumber: await seal(CREDS_KEY, ACCOUNT_NUMBER),
    accountLast4: '8514',
    accountType: 'Corriente',
    holderId: 'J-12345678-9',
    verifiedAt: NOW - 86_400 * 30,
    credsExpireAt: null,
    status: 'active',
    createdAt: NOW - 86_400 * 60,
    ...overrides,
  };
}

function fakeBanks(authenticate?: Result<BankSession, BankFailure>) {
  const gateway: BankGateway = {
    id: 'banesco',
    displayName: 'Banesco',
    environments: ['production', 'sandbox'],
    credentialGroups: [
      { key: 'main', usage: 'operate', label: 'Principal', required: true, fields: [] },
    ],
    async authenticate() {
      return authenticate ?? ok(SESSION);
    },
    async listAccounts() {
      return ok([]);
    },
    async findPayment() {
      return ok(null);
    },
    async listMovements() {
      return ok([]);
    },
  };
  return { get: () => gateway };
}

function fakeAccounts(stored: BankAccount) {
  const updates: {
    credentials: Sealed;
    accountNumber: Sealed;
    clientIdLast6: string | null;
    verifiedAt: number;
  }[] = [];

  return {
    updates,
    accounts: {
      async findById(id: string) {
        return stored.id === id ? stored : null;
      },
      async updateCredentials(
        _id: string,
        credentials: Sealed,
        accountNumber: Sealed,
        clientIdLast6: string | null,
        verifiedAt: number,
      ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
        updates.push({ credentials, accountNumber, clientIdLast6, verifiedAt });
        return ok({
          ...stored,
          credentials,
          accountNumber,
          clientIdLast6,
          verifiedAt,
          status: 'active',
        });
      },
    },
  };
}

async function harness(
  options: { authenticate?: Result<BankSession, BankFailure>; account?: Partial<BankAccount> } = {},
) {
  const stored = await account(options.account);
  const store = fakeAccounts(stored);
  const changeBankCredentials = makeChangeBankCredentials({
    banks: fakeBanks(options.authenticate),
    accounts: store.accounts,
    credsKey: CREDS_KEY,
    clock: fixedClock(NOW),
  });
  return { changeBankCredentials, ...store };
}

const INPUT = { companyId: 'la-espiga', accountId: 'account-1', credentials: NEW };

describe('change bank credentials', () => {
  it('verifies the new credentials and re-seals them onto the account', async () => {
    const { changeBankCredentials, updates } = await harness();

    const result = await changeBankCredentials(INPUT);

    expect(result).toMatchObject({
      ok: true,
      value: { status: 'active', clientIdLast6: '999999' },
    });
    expect(updates).toHaveLength(1);
    // The row now seals the NEW pair; the account number rides along unchanged.
    expect(await unseal<AccountCredentials>(CREDS_KEY, updates[0].credentials)).toEqual(NEW);
    expect(await unseal<string>(CREDS_KEY, updates[0].accountNumber)).toBe(ACCOUNT_NUMBER);
    expect(updates[0].verifiedAt).toBe(NOW);
  });

  it('refuses credentials the bank rejects, and writes nothing', async () => {
    const { changeBankCredentials, updates } = await harness({
      authenticate: err('rejected_credentials'),
    });

    expect(await changeBankCredentials(INPUT)).toEqual({
      ok: false,
      error: 'rejected_credentials',
    });
    expect(updates).toHaveLength(0);
  });

  it('refuses another merchant’s account, and a removed one, as not_found', async () => {
    const theirs = await harness({ account: { companyId: 'otra-empresa' } });
    expect(await theirs.changeBankCredentials(INPUT)).toEqual({ ok: false, error: 'not_found' });
    expect(theirs.updates).toHaveLength(0);

    const removed = await harness({ account: { status: 'removed' } });
    expect(await removed.changeBankCredentials(INPUT)).toEqual({ ok: false, error: 'not_found' });
  });

  it('requires the operate pair', async () => {
    const { changeBankCredentials, updates } = await harness();
    expect(await changeBankCredentials({ ...INPUT, credentials: {} })).toEqual({
      ok: false,
      error: 'invalid_input',
    });
    expect(updates).toHaveLength(0);
  });
});
