import { describe, expect, it } from 'vitest';

import type { Clock } from '../../shared/clock.ts';
import { makeFakeKv } from './kv.fake.ts';
import { KvSessionStore, SESSION_TTL_SECONDS, type SessionRecord } from './session.store.ts';

/** A clock a test can move, which is the whole point of the sliding TTL here. */
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

const RECORD: SessionRecord = {
  userId: 'user-1',
  role: 'cashier',
  companyId: 'la-espiga',
  name: 'María R.',
  username: 'maria.r',
  email: null,
  createdAt: 1_770_000_000,
  shiftAckAt: 1_770_000_000,
  ipHash: 'b1946ac92492d2347c6235b4d2611184',
};

describe('put and get', () => {
  it('stores under session:<id> with the sliding TTL', async () => {
    const fake = makeFakeKv();
    await new KvSessionStore(fake.kv, movableClock(1_770_000_000)).put('sess-1', RECORD);

    expect(fake.entries.get('session:sess-1')?.expirationTtl).toBe(SESSION_TTL_SECONDS);
  });

  it('round-trips the record', async () => {
    const fake = makeFakeKv();
    const store = new KvSessionStore(fake.kv, movableClock(1_770_000_000));

    await store.put('sess-1', RECORD);

    expect(await store.get('sess-1')).toEqual(RECORD);
  });

  it('returns null for an unknown session', async () => {
    const fake = makeFakeKv();
    expect(await new KvSessionStore(fake.kv, movableClock(0)).get('nope')).toBeNull();
  });

  it('drops a record that no longer parses instead of serving it', async () => {
    const fake = makeFakeKv();
    const store = new KvSessionStore(fake.kv, movableClock(0));
    await fake.kv.put('session:sess-1', JSON.stringify({ userId: 'user-1', role: 'wizard' }));

    expect(await store.get('sess-1')).toBeNull();
    expect(fake.entries.has('session:sess-1')).toBe(false);
  });

  it('drops a record that is not JSON at all', async () => {
    const fake = makeFakeKv();
    await fake.kv.put('session:sess-1', 'not json');

    expect(await new KvSessionStore(fake.kv, movableClock(0)).get('sess-1')).toBeNull();
  });
});

describe('touch', () => {
  it('does not rewrite the record on every request', async () => {
    const fake = makeFakeKv();
    const clock = movableClock(1_770_000_000);
    const store = new KvSessionStore(fake.kv, clock);
    await store.put('sess-1', RECORD);

    await store.touch('sess-1');
    await store.touch('sess-1');
    clock.advance(60);
    await store.touch('sess-1');

    // Only the original put. KV does not want a write per request on one key.
    expect(fake.writes.get('session:sess-1')).toBe(1);
  });

  it('renews once the last write is old enough to matter', async () => {
    const fake = makeFakeKv();
    const clock = movableClock(1_770_000_000);
    const store = new KvSessionStore(fake.kv, clock);
    await store.put('sess-1', RECORD);

    clock.advance(60 * 60);
    const renewed = await store.touch('sess-1');

    expect(renewed).toEqual(RECORD);
    expect(fake.writes.get('session:sess-1')).toBe(2);
  });

  it('never expires on its own: the TTL is the same every renewal', async () => {
    const fake = makeFakeKv();
    const clock = movableClock(1_770_000_000);
    const store = new KvSessionStore(fake.kv, clock);
    await store.put('sess-1', RECORD);

    for (let day = 0; day < 90; day++) {
      clock.advance(60 * 60 * 24);
      await store.touch('sess-1');
    }

    expect(fake.entries.get('session:sess-1')?.expirationTtl).toBe(SESSION_TTL_SECONDS);
    expect(await store.get('sess-1')).toEqual(RECORD);
  });
});

describe('ackShift', () => {
  it('moves the counter in the record, not in the client', async () => {
    const fake = makeFakeKv();
    const store = new KvSessionStore(fake.kv, movableClock(1_770_000_000));
    await store.put('sess-1', RECORD);

    const acknowledged = await store.ackShift('sess-1', 1_770_014_400);

    expect(acknowledged?.shiftAckAt).toBe(1_770_014_400);
    // Re-read: a reload or a second tab reads the same stored instant, so
    // neither can restart the four hours by throwing away local state.
    expect((await store.get('sess-1'))?.shiftAckAt).toBe(1_770_014_400);
  });

  it('leaves everything else untouched', async () => {
    const fake = makeFakeKv();
    const store = new KvSessionStore(fake.kv, movableClock(1_770_000_000));
    await store.put('sess-1', RECORD);

    const acknowledged = await store.ackShift('sess-1', 1_770_014_400);

    expect(acknowledged).toEqual({ ...RECORD, shiftAckAt: 1_770_014_400 });
  });

  it('returns null for a session that is gone', async () => {
    const fake = makeFakeKv();
    expect(await new KvSessionStore(fake.kv, movableClock(0)).ackShift('nope', 1)).toBeNull();
  });
});

describe('delete and deleteAllForUser', () => {
  it('removes the record and its reverse-index key', async () => {
    const fake = makeFakeKv();
    const store = new KvSessionStore(fake.kv, movableClock(0));
    await store.put('sess-1', RECORD);

    await store.delete('sess-1');

    expect([...fake.entries.keys()]).toEqual([]);
  });

  it('ends every session a user has, on every device', async () => {
    const fake = makeFakeKv();
    const store = new KvSessionStore(fake.kv, movableClock(0));
    await store.put('sess-1', RECORD);
    await store.put('sess-2', RECORD);
    await store.put('sess-3', { ...RECORD, userId: 'user-2' });

    const ended = await store.deleteAllForUser('user-1');

    expect(ended).toBe(2);
    expect(await store.get('sess-1')).toBeNull();
    expect(await store.get('sess-2')).toBeNull();
    expect(await store.get('sess-3')).not.toBeNull();
  });

  it('is a no-op for a user with nothing open', async () => {
    const fake = makeFakeKv();
    expect(await new KvSessionStore(fake.kv, movableClock(0)).deleteAllForUser('ghost')).toBe(0);
  });
});
