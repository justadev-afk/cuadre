import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { type LoginStats, makeGetLoginStats } from './login-stats.ts';

const NOW = 1_786_060_000;

function harness(opts: {
  raw?: { merchants: number; paymentsToday: number; avgLatencyMs: number | null };
  seed?: LoginStats | null;
}) {
  const calls = { read: 0, put: 0 };
  let stored: LoginStats | null = opts.seed ?? null;

  const reader = {
    async read() {
      calls.read++;
      return opts.raw ?? { merchants: 0, paymentsToday: 0, avgLatencyMs: null };
    },
  };
  const cache = {
    async get() {
      return stored;
    },
    async put(stats: LoginStats) {
      calls.put++;
      stored = stats;
    },
  };

  const loginStats = makeGetLoginStats({
    reader,
    cache,
    clock: fixedClock(NOW),
    cacheTtlSeconds: 60,
  });
  return { loginStats, calls, current: () => stored };
}

describe('login stats', () => {
  it('serves the KV snapshot without touching the database', async () => {
    const seed: LoginStats = { merchants: 7, paymentsToday: 42, avgResponseSeconds: 2.4 };
    const { loginStats, calls } = harness({ seed });

    expect(await loginStats()).toEqual(seed);
    expect(calls.read).toBe(0);
  });

  it('computes from the database on a miss and caches the snapshot', async () => {
    const { loginStats, calls, current } = harness({
      raw: { merchants: 128, paymentsToday: 9412, avgLatencyMs: 2380 },
    });

    const stats = await loginStats();

    // 2380 ms rounds to one decimal of seconds.
    expect(stats).toEqual({ merchants: 128, paymentsToday: 9412, avgResponseSeconds: 2.4 });
    expect(calls.read).toBe(1);
    expect(calls.put).toBe(1);
    expect(current()).toEqual(stats);
  });

  it('reads a fresh day as a zero average, not a crash', async () => {
    const { loginStats } = harness({
      raw: { merchants: 3, paymentsToday: 0, avgLatencyMs: null },
    });

    expect(await loginStats()).toEqual({ merchants: 3, paymentsToday: 0, avgResponseSeconds: 0 });
  });
});
