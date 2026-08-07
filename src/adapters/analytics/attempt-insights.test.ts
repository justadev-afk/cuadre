import { describe, expect, it } from 'vitest';

import { CloudflareAttemptInsights } from './attempt-insights.ts';

/** A `fetch` that records its call and answers with a canned SQL API reply. */
function fakeFetch(reply: unknown, opts: { ok?: boolean; status?: number } = {}) {
  const calls: { url: string; body: string; auth: string }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(url),
      body: String(init?.body ?? ''),
      auth: headers.get('authorization') ?? '',
    });
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => reply,
    } as Response;
  }) as typeof fetch;
  return { fn, calls };
}

function insights(fetchFn: typeof fetch) {
  return new CloudflareAttemptInsights({ accountId: 'acct-123', apiToken: 'tok-abc', fetchFn });
}

describe('outcomeBuckets', () => {
  it('queries the dataset for the window and parses the rows', async () => {
    const { fn, calls } = fakeFetch({
      data: [
        { outcome: 'confirmed', bank_status: '', n: 40, latency_sum: 20_000 },
        { outcome: 'bank_failure', bank_status: 'rejected_credentials', n: 3, latency_sum: 900 },
      ],
    });

    const buckets = await insights(fn).outcomeBuckets({ days: 7 });

    expect(calls[0]?.url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct-123/analytics_engine/sql',
    );
    expect(calls[0]?.auth).toBe('Bearer tok-abc');
    expect(calls[0]?.body).toContain('FROM cuadre_attempts');
    expect(calls[0]?.body).toContain("INTERVAL '7' DAY");
    expect(calls[0]?.body).toContain('GROUP BY blob5, blob6');
    // No company scope in the platform-wide query.
    expect(calls[0]?.body).not.toContain('index1 =');
    expect(buckets).toEqual([
      { outcome: 'confirmed', bankStatus: '', count: 40, latencySumMs: 20_000 },
      {
        outcome: 'bank_failure',
        bankStatus: 'rejected_credentials',
        count: 3,
        latencySumMs: 900,
      },
    ]);
  });

  it('scopes to one company and escapes the slug', async () => {
    const { fn, calls } = fakeFetch({ data: [] });

    await insights(fn).outcomeBuckets({ days: 30, companyId: "o'brien" });

    expect(calls[0]?.body).toContain("AND index1 = 'o''brien'");
  });

  it('coerces string aggregates and reads a null bank code as empty', async () => {
    // Analytics Engine may return a sum as a string and a null blob as null.
    const { fn } = fakeFetch({
      data: [{ outcome: 'not_found', bank_status: null, n: '128', latency_sum: '5000' }],
    });

    const buckets = await insights(fn).outcomeBuckets({ days: 1 });

    expect(buckets[0]).toEqual({
      outcome: 'not_found',
      bankStatus: '',
      count: 128,
      latencySumMs: 5000,
    });
  });

  it('clamps an absurd window instead of trusting it', async () => {
    const { fn, calls } = fakeFetch({ data: [] });
    await insights(fn).outcomeBuckets({ days: 100_000 });
    expect(calls[0]?.body).toContain("INTERVAL '400' DAY");
  });
});

describe('topFailingCompanies', () => {
  it('ranks bank failures by company and drops empty ids', async () => {
    const { fn, calls } = fakeFetch({
      data: [
        { company: 'la-espiga', n: 9 },
        { company: '', n: 2 },
      ],
    });

    const rows = await insights(fn).topFailingCompanies(7, 8);

    expect(calls[0]?.body).toContain("blob5 = 'bank_failure'");
    expect(calls[0]?.body).toContain('ORDER BY n DESC');
    expect(calls[0]?.body).toContain('LIMIT 8');
    expect(rows).toEqual([{ companyId: 'la-espiga', failures: 9 }]);
  });
});

describe('failures', () => {
  it('throws on a non-200 so the use case can degrade to an error view', async () => {
    const { fn } = fakeFetch({}, { ok: false, status: 403 });
    await expect(insights(fn).outcomeBuckets({ days: 7 })).rejects.toMatchObject({
      detail: expect.stringContaining('403'),
    });
  });

  it('throws on an unreadable body', async () => {
    const { fn } = fakeFetch({ unexpected: true });
    await expect(insights(fn).outcomeBuckets({ days: 7 })).rejects.toMatchObject({
      detail: expect.stringContaining('unreadable'),
    });
  });
});
