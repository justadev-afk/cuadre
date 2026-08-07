import { describe, expect, it } from 'vitest';

import type {
  BankAccount,
  BankAccountWriteFailure,
  NewBankAccount,
} from '../../adapters/d1/bank-account.repository.ts';
import { fixedClock } from '../../shared/clock.ts';
import { type Sealed, seal, unseal } from '../../shared/crypto.ts';
import { fakeIdGen } from '../../shared/id.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { BankAccountSummary, BankCredentials } from '../ports/bank-gateway.ts';
import { makeConnectBankAccount } from './connect-bank-account.ts';
import type { VerificationPayload } from './pending-verification.ts';

const NOW = 1_770_000_000;
const CREDS_KEY = 'a-test-master-key-of-at-least-32-bytes';
const ACCOUNT_NUMBER = '01340123450123458514';

/** The operate pair the counter runs on. `-client` makes the tail 'client'. */
const OPERATE: BankCredentials = {
  clientId: 'cuadre-qa-client',
  clientSecret: 'super-secret-value',
};

const ACCOUNTS: BankAccountSummary[] = [
  {
    accountId: ACCOUNT_NUMBER,
    masked: '1340************8514',
    type: 'Corriente',
    balanceCents: 1_240_000,
    holderId: 'J-12345678-9',
  },
];

/** Onboarding took the discover path: a real list, and a handle picks from it. */
const PAYLOAD: VerificationPayload = {
  companyId: 'la-espiga',
  bank: 'banesco',
  environment: 'sandbox',
  credentials: { confirmation: OPERATE },
  operateKey: 'confirmation',
  accounts: ACCOUNTS,
};

/** Onboarding took the manual path: no discover pair, so no list to pick from. */
const MANUAL_PAYLOAD: VerificationPayload = { ...PAYLOAD, accounts: [] };

const INPUT = { companyId: 'la-espiga', verifyId: 'verify-1', accountId: 'acct-0' };

function fakeAccounts(failure?: BankAccountWriteFailure) {
  const inserted: NewBankAccount[] = [];
  const verifications: Array<{ id: string; at: number }> = [];

  const row = (input: NewBankAccount, verifiedAt: number | null): BankAccount => ({
    ...input,
    verifiedAt,
    status: 'active',
  });

  return {
    inserted,
    verifications,
    accounts: {
      async insert(input: NewBankAccount): Promise<Result<BankAccount, BankAccountWriteFailure>> {
        inserted.push(input);
        return failure === undefined ? ok(row(input, null)) : err(failure);
      },
      async markVerified(
        id: string,
        at: number,
      ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
        verifications.push({ id, at });
        const written = inserted.find((account) => account.id === id);
        return written === undefined ? err('not_found') : ok(row(written, at));
      },
    },
  };
}

function fakeVerifications(seed: Sealed | null) {
  const entries = new Map<string, Sealed>();
  if (seed !== null) entries.set('verify-1', seed);

  return {
    entries,
    verifications: {
      async put(verifyId: string, sealed: Sealed) {
        entries.set(verifyId, sealed);
      },
      async get(verifyId: string) {
        return entries.get(verifyId) ?? null;
      },
      async delete(verifyId: string) {
        entries.delete(verifyId);
      },
    },
  };
}

async function harness(
  options: { payload?: VerificationPayload | null; insert?: BankAccountWriteFailure } = {},
) {
  const payload = options.payload === null ? null : (options.payload ?? PAYLOAD);
  const { verifications, entries } = fakeVerifications(
    payload === null ? null : await seal(CREDS_KEY, payload),
  );
  const store = fakeAccounts(options.insert);

  const connectBankAccount = makeConnectBankAccount({
    accounts: store.accounts,
    verifications,
    credsKey: CREDS_KEY,
    clock: fixedClock(NOW),
    ids: fakeIdGen({ uuids: ['account-1'] }),
  });

  return { connectBankAccount, entries, ...store };
}

describe('connect bank account', () => {
  it('seals the account number and one row per credential pair, keeping only the tails', async () => {
    const { connectBankAccount, inserted } = await harness();

    await connectBankAccount(INPUT);
    const row = inserted[0];

    expect(row).toMatchObject({
      id: 'account-1',
      companyId: 'la-espiga',
      bank: 'banesco',
      environment: 'sandbox',
      accountLast4: '8514',
      clientIdLast6: 'client',
      accountType: 'Corriente',
      holderId: 'J-12345678-9',
      credsExpireAt: null,
      createdAt: NOW,
    });
    expect(await unseal<string>(CREDS_KEY, row?.accountNumber ?? empty())).toBe(ACCOUNT_NUMBER);
    // One row per pair, keyed by service; the operate key is marked operate.
    expect(row?.credentials).toHaveLength(1);
    const confirmation = row?.credentials[0];
    expect(confirmation).toMatchObject({
      credKey: 'confirmation',
      usage: 'operate',
      clientIdLast6: 'client',
    });
    expect(await unseal(CREDS_KEY, confirmation?.credentials ?? empty())).toEqual(OPERATE);
  });

  it('never asks the bank anything — connect only writes', async () => {
    // The use case has no bank access at all: its deps are the store, the KV
    // verifications, the key, the clock and the id generator. There is nothing
    // here it could call, which is the guarantee that saving is not a round-trip.
    const { connectBankAccount, inserted } = await harness();

    expect((await connectBankAccount(INPUT)).ok).toBe(true);
    expect(inserted).toHaveLength(1);
  });

  it('marks the row verified and spends the handle', async () => {
    const { connectBankAccount, verifications, entries } = await harness();

    const result = await connectBankAccount(INPUT);

    expect(verifications).toEqual([{ id: 'account-1', at: NOW }]);
    expect(result).toMatchObject({ ok: true, value: { verifiedAt: NOW, status: 'active' } });
    expect(entries.size).toBe(0);
  });

  it('takes the typed number when onboarding had no discover pair', async () => {
    const { connectBankAccount, inserted } = await harness({ payload: MANUAL_PAYLOAD });

    const result = await connectBankAccount({
      companyId: 'la-espiga',
      verifyId: 'verify-1',
      accountNumber: '0134 0804 1080 4100 5394',
    });

    expect(result.ok).toBe(true);
    const row = inserted[0];
    expect(row?.accountLast4).toBe('5394');
    expect(await unseal<string>(CREDS_KEY, row?.accountNumber ?? empty())).toBe(
      '01340804108041005394',
    );
    expect(await unseal(CREDS_KEY, row?.credentials[0]?.credentials ?? empty())).toEqual(OPERATE);
  });

  it('lets a typed number override the picker when the account is not listed', async () => {
    // The discover list has ...8514, but the merchant banks on ...5394 (masked,
    // or a different affiliation). Typing it wins over the handle.
    const { connectBankAccount, inserted } = await harness();

    const result = await connectBankAccount({
      companyId: 'la-espiga',
      verifyId: 'verify-1',
      accountNumber: '01340804108041005394',
    });

    expect(result.ok).toBe(true);
    expect(inserted[0]?.accountLast4).toBe('5394');
    expect(await unseal<string>(CREDS_KEY, inserted[0]?.accountNumber ?? empty())).toBe(
      '01340804108041005394',
    );
  });

  it('refuses a typed number that is not a plausible account', async () => {
    const { connectBankAccount, inserted } = await harness({ payload: MANUAL_PAYLOAD });

    expect(
      await connectBankAccount({
        companyId: 'la-espiga',
        verifyId: 'verify-1',
        accountNumber: '123',
      }),
    ).toEqual({ ok: false, error: 'invalid_account' });
    expect(inserted).toHaveLength(0);
  });

  it('never lets a sealed envelope reach the caller', async () => {
    const { connectBankAccount } = await harness();

    const result = await connectBankAccount(INPUT);

    expect(JSON.stringify(result)).not.toContain(ACCOUNT_NUMBER);
    expect(result.ok && 'credentials' in result.value).toBe(false);
  });

  it('answers verification_expired when the handle is gone', async () => {
    const { connectBankAccount, inserted } = await harness({ payload: null });

    expect(await connectBankAccount(INPUT)).toEqual({ ok: false, error: 'verification_expired' });
    expect(inserted).toHaveLength(0);
  });

  it('refuses a verification minted for another company', async () => {
    const { connectBankAccount } = await harness({
      payload: { ...PAYLOAD, companyId: 'otra-empresa' },
    });

    await expect(connectBankAccount(INPUT)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuses a handle the bank never listed', async () => {
    const { connectBankAccount, inserted } = await harness();

    expect(await connectBankAccount({ ...INPUT, accountId: 'acct-7' })).toEqual({
      ok: false,
      error: 'unknown_account',
    });
    expect(inserted).toHaveLength(0);
  });

  it('keeps the handle alive when the account is already linked', async () => {
    const { connectBankAccount, entries } = await harness({ insert: 'account_already_linked' });

    expect(await connectBankAccount(INPUT)).toEqual({
      ok: false,
      error: 'account_already_linked',
    });
    // There may be another account in the same list they meant to pick.
    expect(entries.size).toBe(1);
  });

  it('treats an envelope it cannot open as an expired one', async () => {
    const stale = makeConnectBankAccountWithWrongKey();

    expect(await stale.connect(INPUT)).toEqual({ ok: false, error: 'verification_expired' });
  });
});

function empty(): Sealed {
  return { ciphertext: new Uint8Array(), iv: new Uint8Array(), keyVersion: 1 };
}

/** A container that rotated `CREDS_KEY` while a verification was in flight. */
function makeConnectBankAccountWithWrongKey() {
  const entries = new Map<string, Sealed>();
  const store = fakeAccounts();

  const connect = makeConnectBankAccount({
    accounts: store.accounts,
    verifications: {
      async put(verifyId: string, sealed: Sealed) {
        entries.set(verifyId, sealed);
      },
      async get() {
        // Sealed with yesterday's key.
        return seal('a-different-master-key-of-32-plus-bytes', PAYLOAD);
      },
      async delete(verifyId: string) {
        entries.delete(verifyId);
      },
    },
    credsKey: CREDS_KEY,
    clock: fixedClock(NOW),
    ids: fakeIdGen({ uuids: ['account-1'] }),
  });

  return { connect };
}
