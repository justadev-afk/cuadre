import { describe, expect, it } from 'vitest';

import {
  D1BankAccountRepository,
  toBankAccount,
  toStoredCredential,
} from './bank-account.repository.ts';
import { makeFakeD1, uniqueViolation } from './d1.fake.ts';

/** The account number's envelope, sealed on the account row. */
const ACCOUNT_CT = new Uint8Array([10, 20, 30]);
const ACCOUNT_IV = new Uint8Array([1, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144]);
/** A credential pair's envelope, sealed on its own credential row. */
const CRED_CT = new Uint8Array([1, 2, 3, 4]);
const CRED_IV = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2]);

/** D1 hands BLOB columns back as `ArrayBuffer`, not as the view that went in. */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** A `bank_accounts` row, as D1 returns it. No credential columns anymore. */
function accountRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'acct-1',
    company_id: 'la-espiga',
    bank: 'banesco',
    environment: 'production',
    client_id_last6: 'a1b2c3',
    account_ct: asArrayBuffer(ACCOUNT_CT),
    account_iv: asArrayBuffer(ACCOUNT_IV),
    account_key_v: 1,
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

/** A `bank_account_credentials` row, as the grouping query returns it. */
function credRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bank_account_id: 'acct-1',
    id: 'cred-1',
    cred_key: 'confirmation',
    usage: 'operate',
    client_id_last6: 'fedfa0',
    creds_ct: asArrayBuffer(CRED_CT),
    creds_iv: asArrayBuffer(CRED_IV),
    creds_key_v: 1,
    created_at: 1_760_000_000,
    ...overrides,
  };
}

const NEW_ACCOUNT = {
  id: 'acct-1',
  companyId: 'la-espiga',
  bank: 'banesco',
  environment: 'production',
  clientIdLast6: 'a1b2c3',
  accountNumber: { ciphertext: ACCOUNT_CT, iv: ACCOUNT_IV, keyVersion: 1 },
  accountLast4: '7788',
  accountType: 'Corriente',
  holderId: 'J-401234567',
  credentials: [
    {
      id: 'cred-1',
      credKey: 'confirmation',
      usage: 'operate',
      clientIdLast6: 'fedfa0',
      credentials: { ciphertext: CRED_CT, iv: CRED_IV, keyVersion: 1 },
    },
  ],
  credsExpireAt: null,
  createdAt: 1_760_000_000,
} as const;

describe('toBankAccount', () => {
  it('reads the account and credential BLOB columns back as Uint8Array', () => {
    const account = toBankAccount(accountRow(), [toStoredCredential(credRow())]);

    expect(account.accountNumber.ciphertext).toBeInstanceOf(Uint8Array);
    expect([...account.accountNumber.ciphertext]).toEqual([10, 20, 30]);
    expect([...account.accountNumber.iv]).toEqual([...ACCOUNT_IV]);
    expect([...account.credentials[0].credentials.ciphertext]).toEqual([1, 2, 3, 4]);
    expect([...account.credentials[0].credentials.iv]).toEqual([...CRED_IV]);
  });

  it('accepts the byte-array form older D1 revisions returned', () => {
    const account = toBankAccount(accountRow({ account_ct: [10, 20, 30] }), []);
    expect([...account.accountNumber.ciphertext]).toEqual([10, 20, 30]);
  });

  it('gives each sealed value its own key version', () => {
    // The account number and each credential pair now carry independent key
    // versions — the whole point of splitting the credentials into their own rows.
    const account = toBankAccount(accountRow({ account_key_v: 2 }), [
      toStoredCredential(credRow({ creds_key_v: 5 })),
    ]);
    expect(account.accountNumber.keyVersion).toBe(2);
    expect(account.credentials[0].credentials.keyVersion).toBe(5);
  });

  it('carries every credential pair the account holds', () => {
    const account = toBankAccount(accountRow(), [
      toStoredCredential(credRow({ cred_key: 'confirmation', usage: 'operate' })),
      toStoredCredential(credRow({ cred_key: 'consulta', usage: 'discover' })),
    ]);
    expect(account.credentials.map((c) => c.credKey)).toEqual(['confirmation', 'consulta']);
    expect(account.credentials.map((c) => c.usage)).toEqual(['operate', 'discover']);
  });

  it('exposes only the maskable parts in the clear', () => {
    const account = toBankAccount(accountRow(), [toStoredCredential(credRow())]);
    expect(account.accountLast4).toBe('7788');
    expect(account.clientIdLast6).toBe('a1b2c3');
    expect(account).not.toHaveProperty('clientSecret');
  });

  it('fails an unreadable environment away from production', () => {
    expect(toBankAccount(accountRow({ environment: 'staging' }), []).environment).toBe('sandbox');
    expect(toBankAccount(accountRow({ environment: 'production' }), []).environment).toBe(
      'production',
    );
  });

  it('fails an unreadable status closed', () => {
    expect(toBankAccount(accountRow({ status: 'paused' }), []).status).toBe('removed');
    expect(toBankAccount(accountRow({ status: 'needs_reverify' }), []).status).toBe(
      'needs_reverify',
    );
  });

  it('refuses a BLOB column that is not bytes', () => {
    expect(() => toBankAccount(accountRow({ account_ct: 'not-bytes' }), [])).toThrow();
  });
});

describe('toStoredCredential', () => {
  it('reads a credential row into a sealed pair', () => {
    const cred = toStoredCredential(credRow());
    expect(cred).toMatchObject({
      credKey: 'confirmation',
      usage: 'operate',
      clientIdLast6: 'fedfa0',
    });
    expect([...cred.credentials.ciphertext]).toEqual([1, 2, 3, 4]);
    expect(cred.credentials.keyVersion).toBe(1);
  });

  it('fails an unreadable usage closed to discover', () => {
    // A pair whose usage is unreadable is never chosen as operate while another
    // could be. A lone pair is used anyway, by the single-credential rule.
    expect(toStoredCredential(credRow({ usage: 'nonsense' })).usage).toBe('discover');
    expect(toStoredCredential(credRow({ usage: 'operate' })).usage).toBe('operate');
  });

  it('refuses a BLOB column that is not bytes', () => {
    expect(() => toStoredCredential(credRow({ creds_ct: 'not-bytes' }))).toThrow();
  });
});

describe('insert', () => {
  it('binds the sealed values as Uint8Array, each on its own statement', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow()] });

    await new D1BankAccountRepository(fake.db).insert(NEW_ACCOUNT);

    // calls[0] is the account insert; it binds the account-number envelope.
    expect(fake.calls[0]?.args).toContain(ACCOUNT_CT);
    expect(fake.calls[0]?.args).toContain(ACCOUNT_IV);
    // calls[1] is the credential-row insert; it binds the pair's envelope.
    expect(fake.calls[1]?.args).toContain(CRED_CT);
    expect(fake.calls[1]?.args).toContain(CRED_IV);
  });

  it('never binds a plaintext account number or secret', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow()] });

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

  it('refuses to write an account with no credentials, before touching the db', async () => {
    // The invariant migration 0003 exists to keep: no account without
    // credentials. The choke point rejects an empty set outright — nothing is
    // sent to the database, so there is no half-written account to clean up.
    const fake = makeFakeD1();

    await expect(
      new D1BankAccountRepository(fake.db).insert({ ...NEW_ACCOUNT, credentials: [] }),
    ).rejects.toMatchObject({ code: 'internal', detail: expect.stringContaining('credential') });
    expect(fake.calls).toHaveLength(0);
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

describe('replaceCredentials', () => {
  it('clears the old pairs, writes the new set, and re-stamps the account', async () => {
    const fake = makeFakeD1();
    // The batch is DELETE, one INSERT per pair, then the UPDATE that RETURNS.
    fake.reply({ rows: [] }, { rows: [] }, { rows: [accountRow()] });

    const result = await new D1BankAccountRepository(fake.db).replaceCredentials(
      'acct-1',
      [NEW_ACCOUNT.credentials[0]],
      'fedfa0',
      1_770_000_900,
    );

    expect(result.ok).toBe(true);
    expect(fake.calls[0]?.sql).toContain('DELETE FROM bank_account_credentials');
    expect(fake.calls.at(-1)?.sql).toContain('UPDATE bank_accounts');
    // The account number is not among the arguments — its envelope is untouched.
    expect(fake.calls.at(-1)?.args).not.toContain(ACCOUNT_CT);
  });

  it('is not_found when the account update matches nothing', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] }, { rows: [] }, { rows: [] });

    expect(
      await new D1BankAccountRepository(fake.db).replaceCredentials(
        'ghost',
        [NEW_ACCOUNT.credentials[0]],
        null,
        1,
      ),
    ).toEqual({ ok: false, error: 'not_found' });
  });
});

describe('lifecycle', () => {
  it('serves a needs_reverify account at the counter, preferring an active one', async () => {
    const fake = makeFakeD1();
    // The account query, then the credential-loading query hydrate runs.
    fake.reply({ rows: [accountRow({ status: 'needs_reverify' })] }, { rows: [credRow()] });

    const account = await new D1BankAccountRepository(fake.db).findActiveForCompany(
      'la-espiga',
      'production',
    );

    expect(fake.calls[0]?.sql).toContain("status <> 'removed'");
    expect(fake.calls[0]?.sql).toContain("ORDER BY (status = 'active') DESC");
    expect(account?.status).toBe('needs_reverify');
    expect(account?.credentials).toHaveLength(1);
    expect(account?.credentials[0].credKey).toBe('confirmation');
  });

  it('clears needs_reverify when the credentials are verified again', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow({ verified_at: 1_770_000_500 })] }, { rows: [credRow()] });

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
    fake.reply({ rows: [accountRow({ status: 'removed' })] }, { rows: [] });

    const result = await new D1BankAccountRepository(fake.db).remove('acct-1');

    expect(fake.calls[0]?.sql).toContain('UPDATE bank_accounts');
    expect(fake.calls[0]?.sql).not.toContain('DELETE');
    expect(result.ok && result.value.status).toBe('removed');
  });

  it('reports not_found when nothing matched, without a second query', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    expect(await new D1BankAccountRepository(fake.db).setStatus('ghost', 'active')).toEqual({
      ok: false,
      error: 'not_found',
    });
    // A miss never reaches the credential-loading query.
    expect(fake.calls).toHaveLength(1);
  });
});
