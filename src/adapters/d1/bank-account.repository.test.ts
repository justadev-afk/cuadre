import { describe, expect, it } from 'vitest';

import { epochToIso } from '../../shared/clock.ts';
import { toBase64 } from '../../shared/crypto.ts';
import {
  D1BankAccountRepository,
  toBankAccount,
  toStoredCredential,
} from './bank-account.repository.ts';
import { makeFakeD1, uniqueViolation } from './d1.fake.ts';

/** A credential pair's envelope: still sealed, but stored base64 (no BLOBs). */
const CRED_CT = new Uint8Array([1, 2, 3, 4]);
const CRED_IV = new Uint8Array([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2]);
/** The account number is stored in the clear now (§6). */
const ACCOUNT_NUMBER = '01340000000000007788';
const VERIFIED_AT = 1_770_000_000;
const CREATED_AT = 1_760_000_000;

/** A `bank_accounts` row, as D1 returns it: number in the clear, timestamps ISO. */
function accountRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'acct-1',
    company_id: 'la-espiga',
    bank: 'banesco',
    environment: 'production',
    client_id_last6: 'a1b2c3',
    account_number: ACCOUNT_NUMBER,
    account_last4: '7788',
    account_type: 'Corriente',
    holder_id: 'J-401234567',
    verified_at: epochToIso(VERIFIED_AT),
    creds_expire_at: null,
    status: 'active',
    created_at: epochToIso(CREATED_AT),
    ...overrides,
  };
}

/** A `bank_account_credentials` row: the sealed pair as base64 text, created ISO. */
function credRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    bank_account_id: 'acct-1',
    id: 'cred-1',
    cred_key: 'confirmation',
    usage: 'operate',
    client_id_last6: 'fedfa0',
    creds_ct: toBase64(CRED_CT),
    creds_iv: toBase64(CRED_IV),
    creds_key_v: 1,
    created_at: epochToIso(CREATED_AT),
    ...overrides,
  };
}

const NEW_ACCOUNT = {
  id: 'acct-1',
  companyId: 'la-espiga',
  bank: 'banesco',
  environment: 'production',
  clientIdLast6: 'a1b2c3',
  accountNumber: ACCOUNT_NUMBER,
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
  createdAt: CREATED_AT,
} as const;

describe('toBankAccount', () => {
  it('reads the number in the clear, the credential envelope back as bytes, times as epoch', () => {
    const account = toBankAccount(accountRow(), [toStoredCredential(credRow())]);

    expect(account.accountNumber).toBe(ACCOUNT_NUMBER);
    expect(account.credentials[0].credentials.ciphertext).toBeInstanceOf(Uint8Array);
    expect([...account.credentials[0].credentials.ciphertext]).toEqual([1, 2, 3, 4]);
    expect([...account.credentials[0].credentials.iv]).toEqual([...CRED_IV]);
    // ISO in the column, epoch seconds back out.
    expect(account.verifiedAt).toBe(VERIFIED_AT);
    expect(account.createdAt).toBe(CREATED_AT);
  });

  it('reads each credential pair’s own key version', () => {
    const account = toBankAccount(accountRow(), [toStoredCredential(credRow({ creds_key_v: 5 }))]);
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

  it('refuses an account number that is not text', () => {
    expect(() => toBankAccount(accountRow({ account_number: 123 }), [])).toThrow();
  });
});

describe('toStoredCredential', () => {
  it('reads a credential row into a sealed pair, base64-decoded', () => {
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

  it('refuses a credential ciphertext that is not valid base64', () => {
    expect(() => toStoredCredential(credRow({ creds_ct: 'not base64!' }))).toThrow();
  });
});

describe('insert', () => {
  it('binds the account number in the clear and the credential envelope as base64', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [accountRow()] });

    await new D1BankAccountRepository(fake.db).insert(NEW_ACCOUNT);

    // calls[0] is the account insert: the number goes in the clear now.
    expect(fake.calls[0]?.args).toContain(ACCOUNT_NUMBER);
    // calls[1] is the credential-row insert: the sealed pair as base64 text.
    expect(fake.calls[1]?.args).toContain(toBase64(CRED_CT));
    expect(fake.calls[1]?.args).toContain(toBase64(CRED_IV));
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
    // Re-stamps verified_at as ISO, and never touches the account number.
    expect(fake.calls.at(-1)?.args).toContain(epochToIso(1_770_000_900));
    expect(fake.calls.at(-1)?.args).not.toContain(ACCOUNT_NUMBER);
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
    fake.reply(
      { rows: [accountRow({ verified_at: epochToIso(1_770_000_500) })] },
      { rows: [credRow()] },
    );

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
