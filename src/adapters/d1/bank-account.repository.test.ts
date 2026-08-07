import { describe, expect, it } from 'vitest';

import { D1BankAccountRepository, toBankAccount } from './bank-account.repository.ts';
import { makeFakeD1, uniqueViolation } from './d1.fake.ts';

const CREDS_CT = new Uint8Array([1, 2, 3, 4]);
const CREDS_IV = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2]);
const ACCOUNT_CT = new Uint8Array([10, 20, 30]);
const ACCOUNT_IV = new Uint8Array([1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]);

/** D1 hands BLOB columns back as `ArrayBuffer`, not as the view that went in. */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'acct-1',
    company_id: 'la-espiga',
    bank: 'banesco',
    environment: 'production',
    creds_ct: asArrayBuffer(CREDS_CT),
    creds_iv: asArrayBuffer(CREDS_IV),
    creds_key_v: 1,
    client_id_last6: 'a1b2c3',
    account_ct: asArrayBuffer(ACCOUNT_CT),
    account_iv: asArrayBuffer(ACCOUNT_IV),
    account_last4: '7788',
    account_type: 'Corriente',
    holder_id: 'J-401234567',
    verified_at: 1_770_000_000,
    creds_expire_at: null,
    status: 'active',
    created_at: 1_760_000_000,
    ...overrides,
  };
}

const NEW_ACCOUNT = {
  id: 'acct-1',
  companyId: 'la-espiga',
  bank: 'banesco',
  environment: 'production',
  credentials: { ciphertext: CREDS_CT, iv: CREDS_IV, keyVersion: 1 },
  clientIdLast6: 'a1b2c3',
  accountNumber: { ciphertext: ACCOUNT_CT, iv: ACCOUNT_IV, keyVersion: 1 },
  accountLast4: '7788',
  accountType: 'Corriente',
  holderId: 'J-401234567',
  credsExpireAt: null,
  createdAt: 1_760_000_000,
} as const;

describe('toBankAccount', () => {
  it('reads the BLOB columns back as Uint8Array', () => {
    const account = toBankAccount(row());

    expect(account.credentials.ciphertext).toBeInstanceOf(Uint8Array);
    expect([...account.credentials.ciphertext]).toEqual([1, 2, 3, 4]);
    expect([...account.credentials.iv]).toEqual([...CREDS_IV]);
    expect([...account.accountNumber.ciphertext]).toEqual([10, 20, 30]);
    expect([...account.accountNumber.iv]).toEqual([...ACCOUNT_IV]);
  });

  it('accepts the byte-array form older D1 revisions returned', () => {
    const account = toBankAccount(row({ creds_ct: [1, 2, 3, 4] }));
    expect([...account.credentials.ciphertext]).toEqual([1, 2, 3, 4]);
  });

  it('gives both sealed values the row-level key version', () => {
    const account = toBankAccount(row({ creds_key_v: 2 }));
    expect(account.credentials.keyVersion).toBe(2);
    expect(account.accountNumber.keyVersion).toBe(2);
  });

  it('exposes only the maskable parts in the clear', () => {
    const account = toBankAccount(row());
    expect(account.accountLast4).toBe('7788');
    expect(account.clientIdLast6).toBe('a1b2c3');
    expect(account).not.toHaveProperty('clientSecret');
  });

  it('fails an unreadable environment away from production', () => {
    expect(toBankAccount(row({ environment: 'staging' })).environment).toBe('sandbox');
    expect(toBankAccount(row({ environment: 'production' })).environment).toBe('production');
  });

  it('fails an unreadable status closed', () => {
    expect(toBankAccount(row({ status: 'paused' })).status).toBe('removed');
    expect(toBankAccount(row({ status: 'needs_reverify' })).status).toBe('needs_reverify');
  });

  it('refuses a BLOB column that is not bytes', () => {
    expect(() => toBankAccount(row({ creds_ct: 'not-bytes' }))).toThrow();
  });
});

describe('insert', () => {
  it('binds the sealed values as Uint8Array', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row()] });

    await new D1BankAccountRepository(fake.db).insert(NEW_ACCOUNT);

    const bound = fake.calls[0]?.args ?? [];
    expect(bound).toContain(CREDS_CT);
    expect(bound).toContain(CREDS_IV);
    expect(bound).toContain(ACCOUNT_CT);
    expect(bound).toContain(ACCOUNT_IV);
  });

  it('never binds a plaintext account number or secret', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row()] });

    await new D1BankAccountRepository(fake.db).insert(NEW_ACCOUNT);

    const strings = (fake.calls[0]?.args ?? []).filter((a) => typeof a === 'string');
    expect(strings).toEqual([
      'acct-1',
      'la-espiga',
      'banesco',
      'production',
      'a1b2c3',
      '7788',
      'Corriente',
      'J-401234567',
    ]);
  });

  it('reads the per-company unique key as an already-linked account', async () => {
    const fake = makeFakeD1();
    fake.reply({
      throws: uniqueViolation(
        'bank_accounts.company_id',
        'bank_accounts.bank',
        'bank_accounts.environment',
        'bank_accounts.account_last4',
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

describe('lifecycle', () => {
  it('serves a needs_reverify account at the counter, preferring an active one', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row({ status: 'needs_reverify' })] });

    const account = await new D1BankAccountRepository(fake.db).findActiveForCompany(
      'la-espiga',
      'production',
    );

    expect(fake.calls[0]?.sql).toContain("status <> 'removed'");
    expect(fake.calls[0]?.sql).toContain("ORDER BY (status = 'active') DESC");
    expect(account?.status).toBe('needs_reverify');
  });

  it('clears needs_reverify when the credentials are verified again', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row({ verified_at: 1_770_000_500 })] });

    const result = await new D1BankAccountRepository(fake.db).markVerified(
      'acct-1',
      1_770_000_500,
      null,
    );

    expect(fake.calls[0]?.sql).toContain("status = 'active'");
    expect(fake.calls[0]?.sql).toContain("status <> 'removed'");
    expect(result.ok && result.value.verifiedAt).toBe(1_770_000_500);
  });

  it('removes by status, never with a DELETE that history points at', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row({ status: 'removed' })] });

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
  });
});
