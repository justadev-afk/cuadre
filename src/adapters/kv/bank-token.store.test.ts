import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type BankTokenKey, KvBankTokenStore } from './bank-token.store.ts';
import { makeFakeKv } from './kv.fake.ts';

const Token = z.object({ accessToken: z.string(), expiresAt: z.number().int() });

const KEY: BankTokenKey = {
  bank: 'banesco',
  environment: 'production',
  fingerprint: 'b1946ac92492d2347c6235b4d2611184',
};

describe('bank token store', () => {
  it("round-trips a token parsed against the adapter's own schema", async () => {
    const fake = makeFakeKv();
    const store = new KvBankTokenStore(fake.kv);

    await store.put(KEY, { accessToken: 'opaque', expiresAt: 1_770_003_600 }, 600);

    expect(await store.get(KEY, Token)).toEqual({
      accessToken: 'opaque',
      expiresAt: 1_770_003_600,
    });
  });

  it('keys on bank, environment and credential fingerprint together', async () => {
    const fake = makeFakeKv();
    const store = new KvBankTokenStore(fake.kv);
    await store.put(KEY, { accessToken: 'production', expiresAt: 1 }, 600);

    const sandbox = await store.get({ ...KEY, environment: 'sandbox' }, Token);
    const rotated = await store.get({ ...KEY, fingerprint: 'different' }, Token);

    expect(sandbox).toBeNull();
    expect(rotated).toBeNull();
  });

  it('never lets a rotated secret be served the old token', async () => {
    const fake = makeFakeKv();
    const store = new KvBankTokenStore(fake.kv);
    await store.put(KEY, { accessToken: 'minted-with-old-secret', expiresAt: 1 }, 3600);

    // The company changes its client secret; the caller's fingerprint changes
    // with it, so the cached entry is unreachable rather than merely stale.
    expect(await store.get({ ...KEY, fingerprint: 'sha256-of-new-secret' }, Token)).toBeNull();
  });

  it("asks KV for the bank's TTL", async () => {
    const fake = makeFakeKv();
    await new KvBankTokenStore(fake.kv).put(KEY, { accessToken: 'x', expiresAt: 1 }, 540);

    expect([...fake.entries.values()][0]?.expirationTtl).toBe(540);
  });

  it('caps the TTL at a day so a revoked secret cannot keep working', async () => {
    const fake = makeFakeKv();
    await new KvBankTokenStore(fake.kv).put(KEY, { accessToken: 'x', expiresAt: 1 }, 60 * 60 * 48);

    expect([...fake.entries.values()][0]?.expirationTtl).toBe(60 * 60 * 24);
  });

  it('does not cache a token with under a minute of life left', async () => {
    const fake = makeFakeKv();
    await new KvBankTokenStore(fake.kv).put(KEY, { accessToken: 'x', expiresAt: 1 }, 30);

    expect(fake.entries.size).toBe(0);
  });

  it('drops an entry the adapter can no longer parse', async () => {
    const fake = makeFakeKv();
    const store = new KvBankTokenStore(fake.kv);
    await fake.kv.put(
      'bank:banesco:production:b1946ac92492d2347c6235b4d2611184',
      JSON.stringify({ token: 'an older shape' }),
    );

    expect(await store.get(KEY, Token)).toBeNull();
    expect(fake.entries.size).toBe(0);
  });

  it('returns null rather than throwing on a corrupt entry', async () => {
    const fake = makeFakeKv();
    const store = new KvBankTokenStore(fake.kv);
    await fake.kv.put('bank:banesco:production:b1946ac92492d2347c6235b4d2611184', '{not json');

    expect(await store.get(KEY, Token)).toBeNull();
  });

  it('deletes on demand, for a credential that was just rejected', async () => {
    const fake = makeFakeKv();
    const store = new KvBankTokenStore(fake.kv);
    await store.put(KEY, { accessToken: 'x', expiresAt: 1 }, 600);

    await store.delete(KEY);

    expect(await store.get(KEY, Token)).toBeNull();
  });
});
