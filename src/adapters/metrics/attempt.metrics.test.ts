import { describe, expect, it } from 'vitest';

import { AnalyticsEngineAttemptMetrics, type ValidationAttempt } from './attempt.metrics.ts';

function fakeDataset(onWrite?: () => void) {
  const points: AnalyticsEngineDataPoint[] = [];
  const dataset: AnalyticsEngineDataset = {
    writeDataPoint(event) {
      onWrite?.();
      if (event !== undefined) points.push(event);
    },
  };
  return { dataset, points };
}

const CONFIRMED: ValidationAttempt = {
  companyId: 'la-espiga',
  bank: 'banesco',
  environment: 'production',
  searchStrategy: 'exact_reference',
  outcome: 'confirmed',
  bankStatus: '00',
  latencyMs: 812,
  amountCents: 124_000,
};

const NOT_FOUND: ValidationAttempt = {
  ...CONFIRMED,
  searchStrategy: 'none',
  outcome: 'not_found',
  bankStatus: null,
  amountCents: 0,
};

describe('attempt metrics', () => {
  it('writes the blobs in the declared order', () => {
    const { dataset, points } = fakeDataset();

    new AnalyticsEngineAttemptMetrics(dataset).record(CONFIRMED);

    expect(points[0]?.blobs).toEqual([
      'la-espiga',
      'banesco',
      'production',
      'exact_reference',
      'confirmed',
      '00',
    ]);
  });

  it('writes latency and amount as the two doubles', () => {
    const { dataset, points } = fakeDataset();

    new AnalyticsEngineAttemptMetrics(dataset).record(CONFIRMED);

    expect(points[0]?.doubles).toEqual([812, 124_000]);
  });

  it('indexes on the company, which is how the dataset is queried', () => {
    const { dataset, points } = fakeDataset();

    new AnalyticsEngineAttemptMetrics(dataset).record(CONFIRMED);

    expect(points[0]?.indexes).toEqual(['la-espiga']);
  });

  it('records the attempt that found nothing — the only trace it leaves', () => {
    const { dataset, points } = fakeDataset();

    new AnalyticsEngineAttemptMetrics(dataset).record(NOT_FOUND);

    expect(points).toHaveLength(1);
    expect(points[0]?.blobs).toEqual([
      'la-espiga',
      'banesco',
      'production',
      'none',
      'not_found',
      '',
    ]);
    expect(points[0]?.doubles).toEqual([812, 0]);
  });

  it('clips a long value rather than letting one point blow the row limit', () => {
    const { dataset, points } = fakeDataset();

    new AnalyticsEngineAttemptMetrics(dataset).record({
      ...CONFIRMED,
      bankStatus: 'x'.repeat(500),
    });

    const status = points[0]?.blobs?.[5];
    expect(typeof status === 'string' && status.length).toBe(64);
  });

  it('never fails a payment the bank already confirmed', () => {
    const { dataset } = fakeDataset(() => {
      throw new Error('analytics engine is having a day');
    });

    expect(() => new AnalyticsEngineAttemptMetrics(dataset).record(CONFIRMED)).not.toThrow();
  });
});
