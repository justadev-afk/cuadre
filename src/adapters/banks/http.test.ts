import { afterEach, describe, expect, it, vi } from 'vitest';

import { bankFetch, parseJsonBody } from './http.ts';

type Handler = (url: string, init: RequestInit) => Promise<Response>;

function stubFetch(handler: Handler): { calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => {
    calls.push(init);
    return handler(url, init);
  });
  return { calls };
}

/** Never resolves; rejects the way a runtime does when the signal fires. */
const hangs: Handler = (_url, init) =>
  new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('bankFetch', () => {
  it('reports an HTTP status instead of throwing on it', async () => {
    stubFetch(async () => new Response('{"statusCode":"VRN01"}', { status: 401 }));

    const outcome = await bankFetch('https://bank.test/x', { method: 'POST' });

    expect(outcome).toEqual({ kind: 'http', status: 401, body: '{"statusCode":"VRN01"}' });
  });

  it('never lets a bank answer be cached', async () => {
    const fake = stubFetch(async () => new Response('{}', { status: 200 }));

    await bankFetch('https://bank.test/x', { method: 'POST' });

    expect(fake.calls[0].cache).toBe('no-store');
  });

  it('does not retry an answer the bank meant', async () => {
    const fake = stubFetch(async () => new Response('{}', { status: 422 }));

    await bankFetch('https://bank.test/x', {});

    expect(fake.calls).toHaveLength(1);
  });

  it('retries a 5xx exactly once and keeps the second answer', async () => {
    const statuses = [500, 200];
    const fake = stubFetch(async () => new Response('{}', { status: statuses.shift() ?? 599 }));

    const outcome = await bankFetch('https://bank.test/x', {});

    expect(fake.calls).toHaveLength(2);
    expect(outcome).toMatchObject({ kind: 'http', status: 200 });
  });

  it('gives up after that one retry', async () => {
    const fake = stubFetch(async () => new Response('boom', { status: 503 }));

    const outcome = await bankFetch('https://bank.test/x', {});

    expect(fake.calls).toHaveLength(2);
    expect(outcome).toMatchObject({ kind: 'http', status: 503 });
  });

  it('reports a timeout as a timeout, not as a network fault', async () => {
    stubFetch(hangs);

    const outcome = await bankFetch('https://bank.test/x', {}, { timeoutMs: 10, retries: 0 });

    expect(outcome).toEqual({ kind: 'timeout', timeoutMs: 10 });
  });

  it('retries a timeout once', async () => {
    const fake = stubFetch(hangs);

    await bankFetch('https://bank.test/x', {}, { timeoutMs: 10 });

    expect(fake.calls).toHaveLength(2);
  });

  it('does not retry a transport error', async () => {
    const fake = stubFetch(async () => {
      throw new TypeError('getaddrinfo ENOTFOUND');
    });

    const outcome = await bankFetch('https://bank.test/x', {});

    expect(fake.calls).toHaveLength(1);
    expect(outcome).toMatchObject({ kind: 'network' });
  });
});

describe('parseJsonBody', () => {
  it('reads JSON', () => {
    expect(parseJsonBody('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns undefined for the HTML error page a gateway serves', () => {
    expect(parseJsonBody('<html>503</html>')).toBeUndefined();
  });
});
