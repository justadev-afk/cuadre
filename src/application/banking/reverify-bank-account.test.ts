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
  BankCredentials,
  BankEnvironment,
  BankFailure,
  BankGateway,
  BankSession,
} from '../ports/bank-gateway.ts';
import { makeReverifyBankAccount } from './reverify-bank-account.ts';

const NOW = 1_770_000_000;
const CREDS_KEY = 'a-test-master-key-of-at-least-32-bytes';

const CREDENTIALS: BankCredentials = {
  clientId: 'cuadre-qa-client',
  clientSecret: 'super-secret-value',
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
    label: 'Caja principal',
    receivingAccounts: [],
    clientIdLast6: 'client',
    credentials: await seal(CREDS_KEY, { main: CREDENTIALS }),
    verifiedAt: NOW - 86_400 * 30,
    credsExpireAt: null,
    status: 'active',
    createdAt: NOW - 86_400 * 60,
    ...overrides,
  };
}

type Script = { authenticate?: Result<BankSession, BankFailure> };

/** The one kind these tests care about; the gateway's shape, not its behaviour. */
const PAGO_MOVIL = {
  kind: 'pago_movil',
  label: 'Pago móvil',
  referenceDigits: 6,
  needsPayerPhone: true,
  needsReceivingAccount: false,
  needsDate: true,
} as const;

function fakeBanks(script: Script = {}) {
  const asked: Array<{ environment: BankEnvironment; credentials: BankCredentials }> = [];

  const gateway: BankGateway = {
    id: 'banesco',
    displayName: 'Banesco',
    environments: ['production', 'sandbox'],
    credentialGroups: [{ key: 'main', label: 'Principal', required: true, fields: [] }],
    operateKey: 'main',
    receivingAccountRule: null,
    paymentKinds: [PAGO_MOVIL],

    async authenticate(environment: BankEnvironment, credentials: BankCredentials) {
      asked.push({ environment, credentials });
      return script.authenticate ?? ok(SESSION);
    },
    async findPayment() {
      throw new Error('reverify never looks for a payment');
    },
  };

  return { banks: { get: () => gateway }, asked };
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
  const { banks, asked } = fakeBanks(options.script);
  const store = fakeAccounts(stored);

  const reverifyBankAccount = makeReverifyBankAccount({
    banks,
    accounts: store.accounts,
    credsKey: CREDS_KEY,
    clock: fixedClock(NOW),
  });

  return { reverifyBankAccount, asked, ...store };
}

const INPUT = { companyId: 'la-espiga', accountId: 'account-1' };

describe('reverify bank account', () => {
  it('authenticates with the stored operate pair and re-stamps verified_at', async () => {
    // Authenticating is the whole check now: the smoke read that used to follow
    // it needed a receiving account number, which no longer exists — and it
    // proved nothing the token did not.
    const { reverifyBankAccount, asked, verifications } = await harness();

    const result = await reverifyBankAccount(INPUT);

    expect(asked).toEqual([{ environment: 'production', credentials: CREDENTIALS }]);
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
      script: { authenticate: err('maintenance') },
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
