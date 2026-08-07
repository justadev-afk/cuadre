import { describe, expect, it } from 'vitest';

import { type Sealed, unseal } from '../../shared/crypto.ts';
import { fakeIdGen } from '../../shared/id.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type {
  BankAccountSummary,
  BankCredentialGroup,
  BankCredentials,
  BankFailure,
  BankGateway,
  BankSession,
} from '../ports/bank-gateway.ts';
import type { VerificationPayload } from './pending-verification.ts';
import { makeVerifyBankCredentials } from './verify-bank-credentials.ts';

const CREDS_KEY = 'a-test-master-key-of-at-least-32-bytes';
const ACCOUNT_NUMBER = '01340123450123458514';

/** The gateway declares two services; the fake tells the pairs apart by clientId. */
const GROUPS: readonly BankCredentialGroup[] = [
  {
    key: 'confirmation',
    usage: 'operate',
    label: 'Confirmación de Transacciones',
    required: true,
    fields: [{ name: 'clientId', label: 'Client ID', secret: false }],
  },
  {
    key: 'consulta',
    usage: 'discover',
    label: 'Consulta de Saldo',
    required: false,
    fields: [{ name: 'clientId', label: 'Client ID', secret: false }],
  },
];

const OPERATE: BankCredentials = {
  clientId: 'confirmation-client',
  clientSecret: 'confirmation-secret',
};
const DISCOVER: BankCredentials = { clientId: 'consulta-client', clientSecret: 'consulta-secret' };

const SESSION: BankSession = {
  bank: 'banesco',
  environment: 'sandbox',
  correlationId: 'correlation-1',
};

const ACCOUNTS: BankAccountSummary[] = [
  {
    accountId: ACCOUNT_NUMBER,
    masked: '1340************8514',
    type: 'Corriente',
    balanceCents: 1_240_000,
    holderId: 'J-12345678-9',
  },
  {
    accountId: '01340123450123450001',
    masked: '1340************0001',
    type: 'Ahorro',
    balanceCents: null,
    holderId: null,
  },
];

const INPUT = {
  companyId: 'la-espiga',
  bank: 'banesco',
  environment: 'sandbox' as const,
  credentials: { confirmation: OPERATE, consulta: DISCOVER },
};

type Script = {
  authenticateOperate?: Result<BankSession, BankFailure>;
  authenticateDiscover?: Result<BankSession, BankFailure>;
  accounts?: Result<BankAccountSummary[], BankFailure>;
  environments?: readonly ('production' | 'sandbox')[];
};

function fakeBanks(script: Script = {}) {
  const calls = { authenticate: 0, listAccounts: 0 };

  const gateway: BankGateway = {
    id: 'banesco',
    displayName: 'Banesco',
    environments: script.environments ?? ['production', 'sandbox'],
    credentialGroups: GROUPS,

    async authenticate(_environment, credentials) {
      calls.authenticate++;
      if (credentials.clientId === DISCOVER.clientId) {
        return script.authenticateDiscover ?? ok(SESSION);
      }
      return script.authenticateOperate ?? ok(SESSION);
    },
    async listAccounts() {
      calls.listAccounts++;
      return script.accounts ?? ok(ACCOUNTS);
    },
    async findPayment() {
      return ok(null);
    },
    async listMovements() {
      return ok([]);
    },
  };

  return { banks: { get: () => gateway }, calls };
}

function fakeVerifications() {
  const entries = new Map<string, { sealed: Sealed; ttlSeconds: number }>();
  return {
    entries,
    verifications: {
      async put(verifyId: string, sealed: Sealed, ttlSeconds: number) {
        entries.set(verifyId, { sealed, ttlSeconds });
      },
      async get(verifyId: string) {
        return entries.get(verifyId)?.sealed ?? null;
      },
      async delete(verifyId: string) {
        entries.delete(verifyId);
      },
    },
  };
}

function harness(script: Script = {}) {
  const { banks, calls } = fakeBanks(script);
  const { verifications, entries } = fakeVerifications();

  const verifyBankCredentials = makeVerifyBankCredentials({
    banks,
    verifications,
    credsKey: CREDS_KEY,
    ids: fakeIdGen({ uuids: ['verify-1'] }),
  });

  return { verifyBankCredentials, calls, entries };
}

const EMPTY_SEALED: Sealed = { ciphertext: new Uint8Array(), iv: new Uint8Array(), keyVersion: 1 };

describe('verify bank credentials', () => {
  it('returns a handle per account and never the account number', async () => {
    const { verifyBankCredentials } = harness();

    const result = await verifyBankCredentials(INPUT);

    expect(result).toEqual({
      ok: true,
      value: {
        verifyId: 'verify-1',
        accounts: [
          {
            accountId: 'acct-0',
            masked: '1340************8514',
            type: 'Corriente',
            balanceCents: 1_240_000,
            holderId: 'J-12345678-9',
          },
          {
            accountId: 'acct-1',
            masked: '1340************0001',
            type: 'Ahorro',
            balanceCents: null,
            holderId: null,
          },
        ],
      },
    });
    // The whole answer crosses to a browser. Nothing in it is a bank's number.
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_NUMBER);
  });

  it('parks every pair it verified, sealed, for ten minutes', async () => {
    const { verifyBankCredentials, entries } = harness();

    await verifyBankCredentials(INPUT);
    const parked = entries.get('verify-1');

    expect(parked?.ttlSeconds).toBe(600);
    const raw = new TextDecoder().decode(parked?.sealed.ciphertext);
    expect(raw).not.toContain(OPERATE.clientSecret);
    expect(raw).not.toContain(DISCOVER.clientSecret);

    const payload = await unseal<VerificationPayload>(CREDS_KEY, parked?.sealed ?? EMPTY_SEALED);
    expect(payload).toEqual({
      companyId: 'la-espiga',
      bank: 'banesco',
      environment: 'sandbox',
      credentials: { confirmation: OPERATE, consulta: DISCOVER },
      operateKey: 'confirmation',
      accounts: ACCOUNTS,
    });
  });

  it('validates only the operate pair when no discover pair is given', async () => {
    const { verifyBankCredentials, calls, entries } = harness();

    const result = await verifyBankCredentials({
      ...INPUT,
      credentials: { confirmation: OPERATE },
    });

    // One authenticate (operate), no listing: nothing to discover.
    expect(calls.authenticate).toBe(1);
    expect(calls.listAccounts).toBe(0);
    expect(result).toEqual({ ok: true, value: { verifyId: 'verify-1', accounts: [] } });

    const payload = await unseal<VerificationPayload>(
      CREDS_KEY,
      entries.get('verify-1')?.sealed ?? EMPTY_SEALED,
    );
    expect(payload).toMatchObject({
      credentials: { confirmation: OPERATE },
      operateKey: 'confirmation',
      accounts: [],
    });
  });

  it('refuses when the required operate pair is missing, without authenticating', async () => {
    const { verifyBankCredentials, calls, entries } = harness();

    expect(await verifyBankCredentials({ ...INPUT, credentials: { consulta: DISCOVER } })).toEqual({
      ok: false,
      error: { groupKey: 'confirmation', failure: 'invalid_input' },
    });
    expect(calls.authenticate).toBe(0);
    expect(entries.size).toBe(0);
  });

  it('blames the operate group when its pair is rejected', async () => {
    const { verifyBankCredentials } = harness({ authenticateOperate: err('rejected_credentials') });

    expect(await verifyBankCredentials(INPUT)).toEqual({
      ok: false,
      error: { groupKey: 'confirmation', failure: 'rejected_credentials' },
    });
  });

  it('blames the discover group when only its pair is rejected', async () => {
    const { verifyBankCredentials, entries } = harness({
      authenticateDiscover: err('rejected_credentials'),
    });

    expect(await verifyBankCredentials(INPUT)).toEqual({
      ok: false,
      error: { groupKey: 'consulta', failure: 'rejected_credentials' },
    });
    // A failed discover parks nothing: the operate pair alone is not a connection.
    expect(entries.size).toBe(0);
  });

  it('answers no_accounts on the discover group when the affiliation shows nothing', async () => {
    const { verifyBankCredentials, entries } = harness({ accounts: ok([]) });

    expect(await verifyBankCredentials(INPUT)).toEqual({
      ok: false,
      error: { groupKey: 'consulta', failure: 'no_accounts' },
    });
    expect(entries.size).toBe(0);
  });

  it("folds the bank's rate limit into unavailable", async () => {
    const { verifyBankCredentials } = harness({ authenticateOperate: err('rate_limited') });

    expect(await verifyBankCredentials(INPUT)).toEqual({
      ok: false,
      error: { groupKey: 'confirmation', failure: 'unavailable' },
    });
  });

  it('refuses an environment the bank does not run, without authenticating', async () => {
    const { verifyBankCredentials, calls } = harness({ environments: ['production'] });

    expect(await verifyBankCredentials(INPUT)).toEqual({
      ok: false,
      error: { groupKey: 'confirmation', failure: 'environment_mismatch' },
    });
    expect(calls.authenticate).toBe(0);
  });

  it('does not park anything when listing the discover accounts fails', async () => {
    const { verifyBankCredentials, entries } = harness({ accounts: err('maintenance') });

    expect(await verifyBankCredentials(INPUT)).toEqual({
      ok: false,
      error: { groupKey: 'consulta', failure: 'maintenance' },
    });
    expect(entries.size).toBe(0);
  });
});
