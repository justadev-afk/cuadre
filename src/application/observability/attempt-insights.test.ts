import { describe, expect, it } from 'vitest';

import {
  type AttemptInsightsSource,
  type CompanyFailures,
  makeGetAttemptInsights,
  type OutcomeBucket,
} from './attempt-insights.ts';

/** A hand-written fake of the source — no framework, per the testing rules. */
function fakeSource(
  buckets: OutcomeBucket[],
  top: CompanyFailures[] = [],
  onError?: () => never,
): AttemptInsightsSource {
  return {
    async outcomeBuckets() {
      if (onError) onError();
      return buckets;
    },
    async topFailingCompanies() {
      return top;
    },
  };
}

const bucket = (over: Partial<OutcomeBucket>): OutcomeBucket => ({
  outcome: 'confirmed',
  bankStatus: '',
  count: 0,
  latencySumMs: 0,
  ...over,
});

describe('makeGetAttemptInsights', () => {
  it('reports unconfigured when there is no source', async () => {
    const view = await makeGetAttemptInsights({ source: null })({ days: 7 });
    expect(view).toEqual({ status: 'unconfigured' });
  });

  it('folds buckets into outcome totals and an average latency', async () => {
    const source = fakeSource([
      bucket({ outcome: 'confirmed', count: 40, latencySumMs: 20_000 }),
      bucket({ outcome: 'not_found', count: 60, latencySumMs: 30_000 }),
      bucket({ outcome: 'already_charged', count: 5, latencySumMs: 2_500 }),
      bucket({
        outcome: 'bank_failure',
        bankStatus: 'rejected_credentials',
        count: 4,
        latencySumMs: 1_200,
      }),
    ]);

    const view = await makeGetAttemptInsights({ source })({ days: 7 });

    expect(view.status).toBe('ok');
    if (view.status !== 'ok') return;
    expect(view.totalAttempts).toBe(109);
    expect(view.confirmed).toBe(40);
    expect(view.notFound).toBe(60);
    expect(view.alreadyCharged).toBe(5);
    expect(view.bankFailures).toBe(4);
    // (20000 + 30000 + 2500 + 1200) / 109 = 492.66 → 493
    expect(view.avgLatencyMs).toBe(493);
  });

  it('breaks failures down by code, most common first, and names the blank one', async () => {
    const source = fakeSource([
      bucket({ outcome: 'bank_failure', bankStatus: 'rejected_credentials', count: 2 }),
      bucket({ outcome: 'bank_failure', bankStatus: 'unavailable', count: 7 }),
      bucket({ outcome: 'bank_failure', bankStatus: '', count: 1 }),
    ]);

    const view = await makeGetAttemptInsights({ source })({ days: 7 });

    if (view.status !== 'ok') throw new Error('expected ok');
    expect(view.failuresByCode).toEqual([
      { code: 'unavailable', count: 7 },
      { code: 'rejected_credentials', count: 2 },
      { code: 'desconocido', count: 1 },
    ]);
  });

  it('includes the failing-companies ranking for the platform-wide view', async () => {
    const source = fakeSource(
      [bucket({ outcome: 'bank_failure', count: 3 })],
      [{ companyId: 'la-espiga', failures: 3 }],
    );

    const view = await makeGetAttemptInsights({ source })({ days: 30 });

    if (view.status !== 'ok') throw new Error('expected ok');
    expect(view.topFailingCompanies).toEqual([{ companyId: 'la-espiga', failures: 3 }]);
  });

  it('omits the company ranking when scoped to one company', async () => {
    let askedTop = false;
    const source: AttemptInsightsSource = {
      async outcomeBuckets() {
        return [bucket({ outcome: 'bank_failure', count: 1 })];
      },
      async topFailingCompanies() {
        askedTop = true;
        return [{ companyId: 'x', failures: 1 }];
      },
    };

    const view = await makeGetAttemptInsights({ source })({ days: 7, companyId: 'la-espiga' });

    if (view.status !== 'ok') throw new Error('expected ok');
    expect(askedTop).toBe(false);
    expect(view.topFailingCompanies).toEqual([]);
  });

  it('degrades to an error view when the source throws', async () => {
    const source = fakeSource([], [], () => {
      throw new Error('sql api 403');
    });

    const view = await makeGetAttemptInsights({ source })({ days: 7 });
    expect(view).toEqual({ status: 'error' });
  });

  it('reports a zero average latency for an empty window', async () => {
    const view = await makeGetAttemptInsights({ source: fakeSource([]) })({ days: 7 });
    if (view.status !== 'ok') throw new Error('expected ok');
    expect(view.avgLatencyMs).toBe(0);
    expect(view.totalAttempts).toBe(0);
  });
});
