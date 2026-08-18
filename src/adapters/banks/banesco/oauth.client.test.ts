import { afterEach, describe, expect, it, vi } from 'vitest';

import { BanescoOauthClient } from './oauth.client.ts';

// Two fields only: the client is its own resource owner in the password
// grant, so id + secret are all four values the grant needs.
const CREDENTIALS = {
  clientId: 'cuadre-qa-client',
  clientSecret: 'super-secret-value',
};

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
  return new BanescoOauthClient('cuadre/1.0');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getAccessToken', () => {
  it('asks Keycloak for a password grant, form-encoded', async () => {
    const calls = stubFetch(token(300));

    const result = await oauthClient().getAccessToken({
      environment: 'sandbox',
      credentials: CREDENTIALS,
    });

    expect(result).toEqual({ ok: true, value: 'header.payload.signature' });
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

  /**
   * The regression this file exists for. A token used to be cached in KV for
   * `expires_in` minus a minute, so the second validation of a shift — and every
   * *Reintentar* — skipped this call and came back so fast the counter read it
   * as an answer nobody had gone to fetch. On the path that decides whether a
   * customer has paid, every attempt opens its own session.
   */
  it('asks the bank again on the very next call — nothing is remembered', async () => {
    const calls = stubFetch([token(300), token(300)]);
    const oauth = oauthClient();

    await oauth.getAccessToken({ environment: 'sandbox', credentials: CREDENTIALS });
    const second = await oauth.getAccessToken({ environment: 'sandbox', credentials: CREDENTIALS });

    expect(calls).toHaveLength(2);
    expect(second).toEqual({ ok: true, value: 'header.payload.signature' });
  });

  it('never sends a stored request: the fetch itself is no-store', async () => {
    const calls = stubFetch(token(300));

    await oauthClient().getAccessToken({ environment: 'sandbox', credentials: CREDENTIALS });

    expect(calls[0].init.cache).toBe('no-store');
  });

  it.each([
    [401, 'rejected_credentials'],
    [403, 'rejected_credentials'],
    [429, 'rate_limited'],
    [500, 'unavailable'],
  ])('turns HTTP %i into %s', async (status, failure) => {
    stubFetch({ status, body: '{"error":"invalid_client"}' });

    const result = await oauthClient().getAccessToken({
      environment: 'sandbox',
      credentials: CREDENTIALS,
    });

    expect(result).toEqual({ ok: false, error: failure });
  });

  it('refuses a 200 it cannot read', async () => {
    stubFetch({ status: 200, body: '<html>login</html>' });

    const result = await oauthClient().getAccessToken({
      environment: 'sandbox',
      credentials: CREDENTIALS,
    });

    expect(result).toEqual({ ok: false, error: 'unavailable' });
  });

  it('asks the production realm, not QA’s with the “qa” filed off', async () => {
    const calls = stubFetch(token(300));

    const result = await oauthClient().getAccessToken({
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
