import { describe, expect, it } from 'vitest';

import { epochToIso } from '../../shared/clock.ts';
import { toBase64 } from '../../shared/crypto.ts';
import { D1BankAccountRepository, toBankAccount } from './bank-account.repository.ts';
import { makeFakeD1, uniqueViolation } from './d1.fake.ts';

/** The credential map's envelope: still sealed, but stored base64 (no BLOBs). */
const CRED_CT = new Uint8Array([1, 2, 3, 4]);
const CRED_IV = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2]);
const SEALED = { ciphertext: CRED_CT, iv: CRED_IV, keyVersion: 1 };
const VERIFIED_AT = 1_770_000_000;
const CREATED_AT = 1_760_000_000;

/**
 * A `bank_accounts` row, as D1 returns it after 0007: no account number, a
 * merchant-chosen label, the credential map sealed onto the row, timestamps ISO.
 */
function accountRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'acct-1',
    company_id: 'la-espiga',
    bank: 'banesco',
    environment: 'production',
    label: 'Caja principal',
    receiving_accounts: '["01340804108041005394"]',
    client_id_last6: 'a1b2c3',
    creds_ct: toBase64(CRED_CT),
    creds_iv: toBase64(CRED_IV),
    creds_key_v: 1,
    verified_at: epochToIso(VERIFIED_AT),
    creds_expire_at: null,
    status: 'active',
    created_at: epochToIso(CREATED_AT),
    ...overrides,
  };
}

const NEW_ACCOUNT = {
  id: 'acct-1',
  companyId: 'la-espiga',
  bank: 'banesco',
  environment: 'production',
  label: 'Caja principal',
  receivingAccounts: ['01340804108041005394'],
  clientIdLast6: 'a1b2c3',
  credentials: SEALED,
  credsExpireAt: null,
  verifiedAt: VERIFIED_AT,
  createdAt: CREATED_AT,
} as const;

describe('toBankAccount', () => {
  it('reads the credential envelope back as bytes, and times as epoch', () => {
    const account = toBankAccount(accountRow());

    expect(account.credentials.ciphertext).toBeInstanceOf(Uint8Array);
    expect([...account.credentials.ciphertext]).toEqual([1, 2, 3, 4]);
    expect([...account.credentials.iv]).toEqual([...CRED_IV]);
    // ISO in the column, epoch seconds back out.
    expect(account.verifiedAt).toBe(VERIFIED_AT);
    expect(account.createdAt).toBe(CREATED_AT);
  });

  it('reads the envelope’s own key version', () => {
    expect(toBankAccount(accountRow({ creds_key_v: 5 })).credentials.keyVersion).toBe(5);
  });

  it('exposes only the maskable parts in the clear', () => {
    const account = toBankAccount(accountRow());
    expect(account.label).toBe('Caja principal');
    expect(account.clientIdLast6).toBe('a1b2c3');
    expect(account).not.toHaveProperty('clientSecret');
  });

  it('reads an unnamed connection as a null label, not an empty string', () => {
    expect(toBankAccount(accountRow({ label: null })).label).toBeNull();
  });

  it('fails an unreadable environment away from production', () => {
    expect(toBankAccount(accountRow({ environment: 'staging' })).environment).toBe('sandbox');
    expect(toBankAccount(accountRow({ environment: 'production' })).environment).toBe('production');
  });

  it('fails an unreadable status closed', () => {
    expect(toBankAccount(accountRow({ status: 'paused' })).status).toBe('removed');
    expect(toBankAccount(accountRow({ status: 'needs_reverify' })).status).toBe('needs_reverify');
  });

  it('refuses a ciphertext that is not valid base64', () => {
    expect(() => toBankAccount(accountRow({ creds_ct: 'not base64!' }))).toThrow();
  });
});

describe('insert', () => {
  it('binds the credential envelope as base64 text, in one statement', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow()] });

    await new D1BankAccountRepository(fake.db).insert(NEW_ACCOUNT);

    // One statement, not a batch: the credentials live on the account row now.
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.args).toContain(toBase64(CRED_CT));
    expect(fake.calls[0]?.args).toContain(toBase64(CRED_IV));
    expect(fake.calls[0]?.args).toContain('Caja principal');
  });

  it('never binds a BLOB: no raw secret bytes reach the database', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow()] });

    await new D1BankAccountRepository(fake.db).insert(NEW_ACCOUNT);

    const allArgs = fake.calls.flatMap((call) => call.args ?? []);
    // The whole point of migration 0004: nothing is bound as bytes any more.
    expect(allArgs.some((arg) => arg instanceof Uint8Array)).toBe(false);
    // The secret bytes exist only inside the base64, never as a bound value.
    expect(allArgs).not.toContain(CRED_CT);
  });

  it('is born verified: the credentials authenticated a moment ago', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow()] });

    await new D1BankAccountRepository(fake.db).insert(NEW_ACCOUNT);

    expect(fake.calls[0]?.args).toContain(epochToIso(VERIFIED_AT));
  });

  it('reads the per-company unique key as an already-linked connection', async () => {
    const fake = makeFakeD1();
    fake.reply({
      throws: uniqueViolation(
        'bank_accounts.company_id',
        'bank_accounts.bank',
        'bank_accounts.environment',
        'bank_accounts.client_id_last6',
      ),
    });

    const result = await new D1BankAccountRepository(fake.db).insert(NEW_ACCOUNT);

    expect(result).toEqual({ ok: false, error: 'account_already_linked' });
  });

  it('reads a foreign key failure as an unknown company', async () => {
    const fake = makeFakeD1();
    fake.reply({ throws: new Error('D1_ERROR: FOREIGN KEY constraint failed') });

    expect(await new D1BankAccountRepository(fake.db).insert(NEW_ACCOUNT)).toEqual({
      ok: false,
      error: 'unknown_company',
    });
  });
});

describe('replaceCredentials', () => {
  it('rewrites the envelope and re-stamps the account, in one statement', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow()] });

    const result = await new D1BankAccountRepository(fake.db).replaceCredentials(
      'acct-1',
      { ciphertext: new Uint8Array([7, 7]), iv: CRED_IV, keyVersion: 2 },
      'fedfa0',
      1_770_000_900,
    );

    expect(result.ok).toBe(true);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.sql).toContain('UPDATE bank_accounts');
    expect(fake.calls[0]?.sql).toContain("status <> 'removed'");
    expect(fake.calls[0]?.args).toContain(toBase64(new Uint8Array([7, 7])));
    // Re-stamps verified_at as ISO.
    expect(fake.calls[0]?.args).toContain(epochToIso(1_770_000_900));
  });

  it('is not_found when the update matches nothing', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    expect(
      await new D1BankAccountRepository(fake.db).replaceCredentials('ghost', SEALED, null, 1),
    ).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('lifecycle', () => {
  it('serves a needs_reverify connection at the counter, preferring an active one', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow({ status: 'needs_reverify' })] });

    const accounts = await new D1BankAccountRepository(fake.db).listActiveForCompany('la-espiga');

    expect(fake.calls[0]?.sql).toContain("status <> 'removed'");
    expect(fake.calls[0]?.sql).toContain("ORDER BY (environment = 'production') DESC");
    expect(fake.calls[0]?.sql).toContain("(status = 'active') DESC");
    expect(accounts[0]?.status).toBe('needs_reverify');
  });

  it('lists both environments, so the till can offer either', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow(), accountRow({ id: 'acct-2', environment: 'sandbox' })] });

    const accounts = await new D1BankAccountRepository(fake.db).listActiveForCompany('la-espiga');

    expect(accounts.map((a) => a.environment)).toEqual(['production', 'sandbox']);
  });

  it('clears needs_reverify when the credentials are verified again', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow({ verified_at: epochToIso(1_770_000_500) })] });

    const result = await new D1BankAccountRepository(fake.db).markVerified(
      'acct-1',
      1_770_000_500,
      null,
    );

    expect(fake.calls[0]?.sql).toContain("status = 'active'");
    expect(fake.calls[0]?.sql).toContain("status <> 'removed'");
    // Bound as ISO; read back as epoch.
    expect(fake.calls[0]?.args).toContain(epochToIso(1_770_000_500));
    expect(result.ok && result.value.verifiedAt).toBe(1_770_000_500);
  });

  it('removes by status, never with a DELETE that history points at', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow({ status: 'removed' })] });

    const result = await new D1BankAccountRepository(fake.db).remove('acct-1');

    expect(fake.calls[0]?.sql).toContain('UPDATE bank_accounts');
    expect(fake.calls[0]?.sql).not.toContain('DELETE');
    expect(result.ok && result.value.status).toBe('removed');
  });

  it('reports not_found when nothing matched', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    expect(await new D1BankAccountRepository(fake.db).setStatus('ghost', 'active')).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(fake.calls).toHaveLength(1);
  });
});
