import { afterEach, describe, expect, it, vi } from 'vitest';

import { sha256Hex } from '../../../shared/crypto.ts';
import { BanescoOauthClient } from './oauth.client.ts';

// Two fields only: the client is its own resource owner in the password
// grant, so id + secret are all four values the grant needs.
const CREDENTIALS = {
  clientId: 'cuadre-qa-client',
  clientSecret: 'super-secret-value',
};

type StoredValue = { value: string; ttl?: number };

function fakeTokens() {
  const store = new Map<string, StoredValue>();
  const kv = {
    get: async (key: string) => store.get(key)?.value ?? null,
    put: async (key: string, value: string, options?: { expirationTtl?: number }) => {
      store.set(key, { value, ttl: options?.expirationTtl });
    },
  };
  return { store, kv: kv as unknown as KVNamespace };
}

type Reply = { status: number; body: string };

function stubFetch(reply: Reply | Reply[]) {
  const replies = Array.isArray(reply) ? [...reply] : [reply];
  const calls: Array<{ url: string; init: RequestInit }> = [];

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = replies.shift() ?? replies[replies.length - 1];
    if (!next) throw new Error('no reply queued');
    return new Response(next.body, { status: next.status });
  });

  return calls;
}

const token = (expiresIn: number) => ({
  status: 200,
  body: JSON.stringify({ access_token: 'header.payload.signature', expires_in: expiresIn }),
});

function oauthClient() {
  const tokens = fakeTokens();
  return { tokens, oauth: new BanescoOauthClient(tokens.kv, 'cuadre/1.0') };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('requestUncachedToken', () => {
  it('asks Keycloak for a password grant, form-encoded', async () => {
    const calls = stubFetch(token(300));
    const { oauth } = oauthClient();

    const result = await oauth.requestUncachedToken({
      environment: 'sandbox',
      credentials: CREDENTIALS,
    });

    expect(result).toEqual({
      ok: true,
      value: { accessToken: 'header.payload.signature', expiresInSeconds: 300 },
    });
    expect(calls[0].url).toContain('/auth/realms/realm-api-qa/protocol/openid-connect/token');

    const body = new URLSearchParams(String(calls[0].init.body));
    // Not `client_credentials`: the bank's clients answer that grant with
    // `unauthorized_client — Client not enabled to retrieve service account`.
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('client_id')).toBe(CREDENTIALS.clientId);
    expect(body.get('client_secret')).toBe(CREDENTIALS.clientSecret);
    // The client is its own resource owner: username/password ARE the client
    // id and secret, not a separate pair. Confirmed live against QA.
    expect(body.get('username')).toBe(CREDENTIALS.clientId);
    expect(body.get('password')).toBe(CREDENTIALS.clientSecret);
  });

  it('does not cache, so a probe leaves nothing behind', async () => {
    stubFetch(token(300));
    const { tokens, oauth } = oauthClient();

    await oauth.requestUncachedToken({ environment: 'sandbox', credentials: CREDENTIALS });

    expect(tokens.store.size).toBe(0);
  });

  it.each([
    [401, 'rejected_credentials'],
    [403, 'rejected_credentials'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
  ])('turns HTTP %i into %s', async (status, failure) => {
    stubFetch({ status, body: '{"error":"invalid_client"}' });
    const { oauth } = oauthClient();

    const result = await oauth.requestUncachedToken({
      environment: 'sandbox',
      credentials: CREDENTIALS,
    });

    expect(result).toEqual({ ok: false, error: failure });
  });

  it('refuses a 200 it cannot read', async () => {
    stubFetch({ status: 200, body: '<html>login</html>' });
    const { oauth } = oauthClient();

    const result = await oauth.requestUncachedToken({
      environment: 'sandbox',
      credentials: CREDENTIALS,
    });

    expect(result).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('getAccessToken', () => {
  it('caches the token a minute short of the bank’s expiry', async () => {
    stubFetch(token(300));
    const { tokens, oauth } = oauthClient();

    await oauth.getAccessToken({ environment: 'sandbox', credentials: CREDENTIALS });

    const [stored] = [...tokens.store.values()];
    expect(stored).toEqual({ value: 'header.payload.signature', ttl: 240 });
  });

  it('keys the cache by bank, environment and a hash of the client id', async () => {
    stubFetch(token(300));
    const { tokens, oauth } = oauthClient();

    await oauth.getAccessToken({ environment: 'sandbox', credentials: CREDENTIALS });

    const [key] = [...tokens.store.keys()];
    // The client is its own resource owner, so the client id identifies the
    // token completely.
    expect(key).toBe(`bank_token:banesco:sandbox:${await sha256Hex(CREDENTIALS.clientId)}`);
    expect(key).not.toContain(CREDENTIALS.clientSecret);
    expect(key).not.toContain(CREDENTIALS.clientId);
  });

  it('does not ask the bank again while the cached token lives', async () => {
    const calls = stubFetch(token(300));
    const { oauth } = oauthClient();

    await oauth.getAccessToken({ environment: 'sandbox', credentials: CREDENTIALS });
    const second = await oauth.getAccessToken({ environment: 'sandbox', credentials: CREDENTIALS });

    expect(calls).toHaveLength(1);
    expect(second).toEqual({ ok: true, value: 'header.payload.signature' });
  });

  it('skips the cache for a token that would expire inside the safety margin', async () => {
    stubFetch(token(90));
    const { tokens, oauth } = oauthClient();

    const result = await oauth.getAccessToken({ environment: 'sandbox', credentials: CREDENTIALS });

    expect(result).toEqual({ ok: true, value: 'header.payload.signature' });
    expect(tokens.store.size).toBe(0);
  });

  it('asks the production realm, not QA’s with the “qa” filed off', async () => {
    const calls = stubFetch(token(300));
    const { oauth } = oauthClient();

    const result = await oauth.getAccessToken({
      environment: 'production',
      credentials: CREDENTIALS,
    });

    expect(result).toEqual({ ok: true, value: 'header.payload.signature' });
    // Different cluster *and* different realm. Pinned in full because deriving
    // either from the QA name is exactly the mistake this asserts against.
    expect(calls[0].url).toBe(
      'https://sso-sso-project.apps.proplakur.banesco.com/auth/realms/realm-api-prd/protocol/openid-connect/token',
    );
  });
});
