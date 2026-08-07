import { describe, expect, it } from 'vitest';

import type {
  BankAccount,
  BankAccountStatus,
  BankAccountWriteFailure,
} from '../../adapters/d1/bank-account.repository.ts';
import { fixedClock } from '../../shared/clock.ts';
import { seal } from '../../shared/crypto.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type {
  BankFailure,
  BankGateway,
  BankMovement,
  BankSession,
  ListMovementsQuery,
} from '../ports/bank-gateway.ts';
import { makeReverifyBankAccount } from './reverify-bank-account.ts';

const NOW = 1_770_000_000;
const CREDS_KEY = 'a-test-master-key-of-at-least-32-bytes';
const ACCOUNT_NUMBER = '01340123450123458514';

const CREDENTIALS = {
  clientId: 'cuadre-qa-client',
  clientSecret: 'super-secret-value',
  username: 'cuadre-qa-user',
  password: 'super-secret-password',
};

const SESSION: BankSession = {
  bank: 'banesco',
  environment: 'production',
  correlationId: 'correlation-1',
};

async function account(overrides: Partial<BankAccount> = {}): Promise<BankAccount> {
  return {
    id: 'account-1',
    companyId: 'la-espiga',
    bank: 'banesco',
    environment: 'production',
    clientIdLast6: 'client',
    accountNumber: await seal(CREDS_KEY, ACCOUNT_NUMBER),
    credentials: [
      {
        credKey: 'main',
        usage: 'operate',
        clientIdLast6: 'client',
        credentials: await seal(CREDS_KEY, CREDENTIALS),
      },
    ],
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

type Script = {
  authenticate?: Result<BankSession, BankFailure>;
  movements?: Result<BankMovement[], BankFailure>;
};

function fakeBanks(script: Script = {}) {
  const smokeReads: ListMovementsQuery[] = [];

  const gateway: BankGateway = {
    id: 'banesco',
    displayName: 'Banesco',
    environments: ['production', 'sandbox'],
    credentialGroups: [
      { key: 'main', usage: 'operate', label: 'Principal', required: true, fields: [] },
    ],

    async authenticate() {
      return script.authenticate ?? ok(SESSION);
    },
    async listAccounts() {
      return ok([]);
    },
    async findPayment() {
      return ok(null);
    },
    async listMovements(_session, query) {
      smokeReads.push(query);
      return script.movements ?? ok([]);
    },
  };

  return { banks: { get: () => gateway }, smokeReads };
}

function fakeAccounts(stored: BankAccount) {
  const statuses: BankAccountStatus[] = [];
  const verifications: number[] = [];

  return {
    statuses,
    verifications,
    accounts: {
      async findById(id: string) {
        return stored.id === id ? stored : null;
      },
      async markVerified(
        _id: string,
        at: number,
      ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
        verifications.push(at);
        return ok({ ...stored, verifiedAt: at, status: 'active' });
      },
      async setStatus(
        _id: string,
        status: BankAccountStatus,
      ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
        statuses.push(status);
        return ok({ ...stored, status });
      },
    },
  };
}

async function harness(options: { script?: Script; account?: Partial<BankAccount> } = {}) {
  const stored = await account(options.account);
  const { banks, smokeReads } = fakeBanks(options.script);
  const store = fakeAccounts(stored);

  const reverifyBankAccount = makeReverifyBankAccount({
    banks,
    accounts: store.accounts,
    credsKey: CREDS_KEY,
    clock: fixedClock(NOW),
  });

  return { reverifyBankAccount, smokeReads, ...store };
}

const INPUT = { companyId: 'la-espiga', accountId: 'account-1' };

describe('reverify bank account', () => {
  it('reads the account with the stored credentials and re-stamps verified_at', async () => {
    const { reverifyBankAccount, smokeReads, verifications } = await harness();

    const result = await reverifyBankAccount(INPUT);

    expect(smokeReads).toEqual([
      { accountId: ACCOUNT_NUMBER, from: '2026-02-01', to: '2026-02-01' },
    ]);
    expect(verifications).toEqual([NOW]);
    expect(result).toMatchObject({ ok: true, value: { verifiedAt: NOW, status: 'active' } });
  });

  it('flags the account when the bank rejects the credentials', async () => {
    const { reverifyBankAccount, statuses } = await harness({
      script: { authenticate: err('rejected_credentials') },
    });

    expect(await reverifyBankAccount(INPUT)).toEqual({
      ok: false,
      error: 'rejected_credentials',
    });
    expect(statuses).toEqual(['needs_reverify']);
  });

  it('leaves the status alone when the bank is merely unwell', async () => {
    const { reverifyBankAccount, statuses, verifications } = await harness({
      script: { movements: err('maintenance') },
    });

    expect(await reverifyBankAccount(INPUT)).toEqual({ ok: false, error: 'maintenance' });
    // A bad ten minutes at the bank must not put a red badge on every panel.
    expect(statuses).toEqual([]);
    expect(verifications).toEqual([]);
  });

  it('clears the needs_reverify flag when the credentials work again', async () => {
    const { reverifyBankAccount } = await harness({ account: { status: 'needs_reverify' } });

    expect(await reverifyBankAccount(INPUT)).toMatchObject({
      ok: true,
      value: { status: 'active' },
    });
  });

  it('refuses a removed account, and another merchant’s account', async () => {
    const removed = await harness({ account: { status: 'removed' } });
    expect(await removed.reverifyBankAccount(INPUT)).toEqual({ ok: false, error: 'not_found' });

    const theirs = await harness({ account: { companyId: 'otra-empresa' } });
    expect(await theirs.reverifyBankAccount(INPUT)).toEqual({ ok: false, error: 'not_found' });
  });
});
