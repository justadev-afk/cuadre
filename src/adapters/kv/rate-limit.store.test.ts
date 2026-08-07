import { describe, expect, it } from 'vitest';

import type { Clock } from '../../shared/clock.ts';
import { makeFakeKv } from './kv.fake.ts';
import { KvRateLimiter, RATE_LIMITS } from './rate-limit.store.ts';

function movableClock(start: number): Clock & { advance(seconds: number): void } {
  let now = start;
  return {
    nowSeconds: () => now,
    nowMillis: () => now * 1000,
    advance: (seconds) => {
      now += seconds;
    },
  };
}

const PIN = RATE_LIMITS.pinByUser;

describe('hit', () => {
  it('counts down and refuses the sixth PIN attempt in an hour', async () => {
    const fake = makeFakeKv();
    const store = new KvRateLimiter(fake.kv, movableClock(1_770_000_000));

    const verdicts = [];
    for (let attempt = 0; attempt < 6; attempt++) {
      verdicts.push(await store.hit('pin', 'user-1', PIN));
    }

    expect(verdicts.map((v) => v.remaining)).toEqual([4, 3, 2, 1, 0, 0]);
    expect(verdicts.map((v) => v.allowed)).toEqual([true, true, true, true, true, false]);
  });

  it('reports the instant the window rolls over, not the instant of the hit', async () => {
    const fake = makeFakeKv();
    // 1_770_000_000 sits 2_400 seconds into its hour, so the window it belongs
    // to began at 1_769_997_600 and rolls at 1_770_001_200.
    const store = new KvRateLimiter(fake.kv, movableClock(1_770_000_000));

    const verdict = await store.hit('pin', 'user-1', PIN);

    expect(verdict.resetAt).toBe(1_770_001_200);
  });

  it('starts clean in the next window without anything resetting it', async () => {
    const fake = makeFakeKv();
    const clock = movableClock(1_770_000_000);
    const store = new KvRateLimiter(fake.kv, clock);
    for (let attempt = 0; attempt < 5; attempt++) await store.hit('pin', 'user-1', PIN);

    clock.advance(3600);
    const fresh = await store.hit('pin', 'user-1', PIN);

    expect(fresh.allowed).toBe(true);
    expect(fresh.remaining).toBe(4);
  });

  it('stops writing once the verdict can no longer change', async () => {
    const fake = makeFakeKv();
    const store = new KvRateLimiter(fake.kv, movableClock(1_770_000_000));
    for (let attempt = 0; attempt < 5; attempt++) await store.hit('pin', 'user-1', PIN);

    const before = [...fake.writes.values()].reduce((a, b) => a + b, 0);
    await store.hit('pin', 'user-1', PIN);
    await store.hit('pin', 'user-1', PIN);

    expect([...fake.writes.values()].reduce((a, b) => a + b, 0)).toBe(before);
  });

  it('keeps scopes and keys apart', async () => {
    const fake = makeFakeKv();
    const store = new KvRateLimiter(fake.kv, movableClock(1_770_000_000));

    await store.hit('pin', 'user-1', PIN);
    const otherUser = await store.hit('pin', 'user-2', PIN);
    const otherScope = await store.hit('login', 'user-1', RATE_LIMITS.loginByUser);

    expect(otherUser.remaining).toBe(4);
    expect(otherScope.remaining).toBe(RATE_LIMITS.loginByUser.limit - 1);
  });

  it('never asks KV for a TTL below its sixty-second floor', async () => {
    const fake = makeFakeKv();
    const store = new KvRateLimiter(fake.kv, movableClock(59));

    await store.hit('burst', 'user-1', { limit: 3, windowSeconds: 60 });

    const ttl = [...fake.entries.values()][0]?.expirationTtl;
    expect(ttl).toBeGreaterThanOrEqual(60);
  });

  it('reads a corrupt counter as zero rather than locking the till out', async () => {
    const fake = makeFakeKv();
    const store = new KvRateLimiter(fake.kv, movableClock(1_770_000_000));
    await fake.kv.put('rl:pin:user-1:1769997600', 'garbage');

    const verdict = await store.hit('pin', 'user-1', PIN);

    expect(verdict.allowed).toBe(true);
    expect(verdict.remaining).toBe(4);
  });
});

describe('reset', () => {
  it('clears the counter a successful login should not carry', async () => {
    const fake = makeFakeKv();
    const store = new KvRateLimiter(fake.kv, movableClock(1_770_000_000));
    await store.hit('pin', 'user-1', PIN);
    await store.hit('pin', 'user-1', PIN);

    await store.reset('pin', 'user-1', PIN);

    expect((await store.hit('pin', 'user-1', PIN)).remaining).toBe(4);
  });
});

describe('RATE_LIMITS', () => {
  it('holds the caps the product states', () => {
    expect(RATE_LIMITS.pinByUser).toEqual({ limit: 5, windowSeconds: 3600 });
    expect(RATE_LIMITS.passwordResetByUser).toEqual({ limit: 3, windowSeconds: 3600 });
  });
});
