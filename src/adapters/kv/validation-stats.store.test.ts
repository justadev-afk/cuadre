import { describe, expect, it } from 'vitest';

import type { ValidationStatsView } from '../../application/validations/validation-stats.ts';
import { makeFakeKv } from './kv.fake.ts';
import { KvValidationStatsCache } from './validation-stats.store.ts';

const VIEW = {
  range: {
    preset: 'last_7_days',
    from: 1_769_400_000,
    to: 1_770_004_799,
    fromDay: '2026-01-26',
    toDay: '2026-02-01',
    days: 7,
    clamped: false,
  },
  totalCount: 2,
  totalAmountCents: 63_000,
  averageTicketCents: 31_500,
  maxAmountCents: 52_508,
  payers: 2,
  activeDays: 1,
  dailyAverageAmountCents: 9000,
  series: [{ date: '2026-02-01', count: 2, amountCents: 63_000 }],
  bestDay: { date: '2026-02-01', count: 2, amountCents: 63_000 },
  byHour: [{ hour: 9, count: 2, amountCents: 63_000 }],
  byCashier: [{ key: 'maria', label: 'María Rodríguez', count: 2, amountCents: 63_000 }],
  bySourceBank: [{ key: '0134', label: 'Banesco', count: 2, amountCents: 63_000 }],
  byKind: [
    { kind: 'pago_movil', count: 2, amountCents: 63_000 },
    { kind: 'transferencia', count: 0, amountCents: 0 },
  ],
} satisfies ValidationStatsView;

const KEY = 'la-espiga:last_7_days:1769400000-1770004799';

describe('KvValidationStatsCache', () => {
  it('round-trips the whole answer, every number still a number', async () => {
    const { kv } = makeFakeKv();
    const cache = new KvValidationStatsCache(kv);

    await cache.put(KEY, VIEW, 3600);

    expect(await cache.get(KEY)).toEqual(VIEW);
  });

  it('answers null for a span nobody has asked about', async () => {
    const { kv } = makeFakeKv();

    expect(await new KvValidationStatsCache(kv).get(KEY)).toBeNull();
  });

  it('writes under its own prefix, with the TTL it was given', async () => {
    const { kv, entries } = makeFakeKv();

    await new KvValidationStatsCache(kv).put(KEY, VIEW, 3600);

    // The namespace is shared with the sessions; the prefix is what keeps this
    // store's keys from ever colliding with `session:` or `rate:`.
    expect([...entries.keys()]).toEqual([`stats:validations:${KEY}`]);
    expect(entries.get(`stats:validations:${KEY}`)?.expirationTtl).toBe(3600);
  });

  it('treats an unreadable value as a miss, never as a failure', async () => {
    const { kv } = makeFakeKv();
    await kv.put(`stats:validations:${KEY}`, 'not json');

    // A cache that throws is worse than no cache: the answer behind it is one
    // D1 batch away, and the screen would 500 over something it wrote itself.
    expect(await new KvValidationStatsCache(kv).get(KEY)).toBeNull();
  });
});
