import { describe, expect, it } from 'vitest';

import type {
  BankAccount,
  BankAccountWriteFailure,
  NewBankAccount,
} from '../../adapters/d1/bank-account.repository.ts';
import { fixedClock } from '../../shared/clock.ts';
import { unseal } from '../../shared/crypto.ts';
import { fakeIdGen } from '../../shared/id.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type {
  BankCredentialGroup,
  BankCredentials,
  BankEnvironment,
  BankFailure,
  BankGateway,
  BankSession,
} from '../ports/bank-gateway.ts';
import type { AccountCredentials } from './account-credentials.ts';
import { makeConnectBankAccount } from './connect-bank-account.ts';

const NOW = 1_770_000_000;
const CREDS_KEY = 'a-test-master-key-of-at-least-32-bytes';

/** The operate pair the counter runs on. `-client` makes the tail 'client'. */
const OPERATE: BankCredentials = {
  clientId: 'cuadre-qa-client',
  clientSecret: 'super-secret-value',
};

const CONFIRMATION: BankCredentialGroup = {
  key: 'confirmation',
  label: 'Confirmación de Transacciones',
  required: true,
  fields: [
    { name: 'clientId', label: 'Client ID', secret: false },
    { name: 'clientSecret', label: 'Client Secret', secret: true },
  ],
};

const INPUT = {
  companyId: 'la-espiga',
  bank: 'banesco',
  environment: 'sandbox' as BankEnvironment,
  label: 'Caja principal',
  credentials: { confirmation: OPERATE } as AccountCredentials,
};

/**
 * A gateway that accepts (or refuses) whatever it is handed. A hand-written
 * fake of the port, never `vi.mock` on our own module (§12).
 */
function fakeGateway(options: { rejects?: BankFailure } = {}) {
  const asked: Array<{ environment: BankEnvironment; credentials: BankCredentials }> = [];

  const gateway: BankGateway = {
    id: 'banesco',
    displayName: 'Banesco',
    environments: ['production', 'sandbox'],
    credentialGroups: [CONFIRMATION],
    operateKey: 'confirmation',
    receivingAccountRule: null,
    paymentKinds: [
      {
        kind: 'pago_movil',
        label: 'Pago móvil',
        referenceDigits: 6,
        needsPayerPhone: true,
        needsReceivingAccount: false,
        needsDate: true,
      },
    ],
    async authenticate(
      environment: BankEnvironment,
      credentials: BankCredentials,
    ): Promise<Result<BankSession, BankFailure>> {
      asked.push({ environment, credentials });
      if (options.rejects !== undefined) return err(options.rejects);
      return ok({ bank: 'banesco', environment, correlationId: 'corr-1' });
    },
    async findPayment() {
      throw new Error('the alta never looks for a payment');
    },
  };

  return { asked, banks: { get: () => gateway } };
}

function fakeAccounts(failure?: BankAccountWriteFailure) {
  const inserted: NewBankAccount[] = [];

  return {
    inserted,
    accounts: {
      async insert(input: NewBankAccount): Promise<Result<BankAccount, BankAccountWriteFailure>> {
        inserted.push(input);
        return failure === undefined ? ok({ ...input, status: 'active' as const }) : err(failure);
      },
    },
  };
}

function harness(options: { rejects?: BankFailure; insert?: BankAccountWriteFailure } = {}) {
  const bank = fakeGateway({ rejects: options.rejects });
  const store = fakeAccounts(options.insert);

  const connectBankAccount = makeConnectBankAccount({
    banks: bank.banks,
    accounts: store.accounts,
    credsKey: CREDS_KEY,
    clock: fixedClock(NOW),
    ids: fakeIdGen({ uuids: ['account-1'] }),
  });

  return { connectBankAccount, ...bank, ...store };
}

describe('connect bank account', () => {
  it('proves the credentials, then writes one row with them sealed', async () => {
    const { connectBankAccount, asked, inserted } = harness();

    const result = await connectBankAccount(INPUT);

    expect(result.ok).toBe(true);
    expect(asked).toEqual([{ environment: 'sandbox', credentials: OPERATE }]);

    const row = inserted[0];
    expect(row).toMatchObject({
      id: 'account-1',
      companyId: 'la-espiga',
      bank: 'banesco',
      environment: 'sandbox',
      label: 'Caja principal',
      clientIdLast6: 'client',
      credsExpireAt: null,
      verifiedAt: NOW,
      createdAt: NOW,
    });
  });

  it('seals the whole credential map as one value, keyed by service', async () => {
    const { connectBankAccount, inserted } = harness();

    await connectBankAccount(INPUT);

    expect(await unseal(CREDS_KEY, inserted[0]?.credentials ?? empty())).toEqual({
      confirmation: OPERATE,
    });
  });

  it('is born verified — the bank answered a moment ago', async () => {
    const { connectBankAccount } = harness();

    expect(await connectBankAccount(INPUT)).toMatchObject({
      ok: true,
      value: { verifiedAt: NOW, status: 'active' },
    });
  });

  it('writes nothing when the bank refuses the credentials', async () => {
    const { connectBankAccount, inserted } = harness({ rejects: 'rejected_credentials' });

    expect(await connectBankAccount(INPUT)).toEqual({ ok: false, error: 'rejected_credentials' });
    expect(inserted).toHaveLength(0);
  });

  it('refuses a required pair left blank without calling the bank', async () => {
    const { connectBankAccount, asked, inserted } = harness();

    expect(await connectBankAccount({ ...INPUT, credentials: {} })).toEqual({
      ok: false,
      error: 'invalid_input',
    });
    expect(asked).toHaveLength(0);
    expect(inserted).toHaveLength(0);
  });

  it('keeps an unnamed connection as a null label, not an empty string', async () => {
    const { connectBankAccount, inserted } = harness();

    await connectBankAccount({ ...INPUT, label: '   ' });

    expect(inserted[0]?.label).toBeNull();
  });

  it('trims a label the merchant padded', async () => {
    const { connectBankAccount, inserted } = harness();

    await connectBankAccount({ ...INPUT, label: '  Delivery  ' });

    expect(inserted[0]?.label).toBe('Delivery');
  });

  it('never lets a sealed envelope reach the caller', async () => {
    const { connectBankAccount } = harness();

    const result = await connectBankAccount(INPUT);

    expect(JSON.stringify(result)).not.toContain(OPERATE.clientSecret);
    expect(result.ok && 'credentials' in result.value).toBe(false);
  });

  it('reports a bank connected twice with the same client', async () => {
    const { connectBankAccount } = harness({ insert: 'account_already_linked' });

    expect(await connectBankAccount(INPUT)).toEqual({
      ok: false,
      error: 'account_already_linked',
    });
  });

  it('refuses an environment the bank does not run, before asking it anything', async () => {
    const { connectBankAccount, asked } = harness();

    // A gateway that lists both is the fake above, so this stands in for the
    // shape of the check rather than for Banesco: an unknown environment is
    // never sent to a bank to be refused.
    expect(
      await connectBankAccount({
        ...INPUT,
        environment: 'staging' as unknown as BankEnvironment,
      }),
    ).toEqual({ ok: false, error: 'environment_mismatch' });
    expect(asked).toHaveLength(0);
  });
});

function empty() {
  return { ciphertext: new Uint8Array(), iv: new Uint8Array(), keyVersion: 1 };
}
