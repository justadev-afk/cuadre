import { describe, expect, it } from 'vitest';

import { type ActiveSessionPointer, KvActiveSessionStore } from './active-session.store.ts';
import { makeFakeKv } from './kv.fake.ts';
import { SESSION_TTL_SECONDS } from './session.store.ts';

const POINTER: ActiveSessionPointer = {
  sessionId: 'sess-1',
  deviceId: 'device-a',
  at: 1_770_000_000,
};

describe('setActive and getActive', () => {
  it('round-trips the pointer under user-active-session:<userId>', async () => {
    const fake = makeFakeKv();
    const store = new KvActiveSessionStore(fake.kv);

    await store.setActive('user-1', POINTER);

    expect(await store.getActive('user-1')).toEqual(POINTER);
    expect(fake.entries.has('user-active-session:user-1')).toBe(true);
  });

  it('writes it under the session TTL, so it ages out with the session', async () => {
    const fake = makeFakeKv();
    await new KvActiveSessionStore(fake.kv).setActive('user-1', POINTER);

    expect(fake.entries.get('user-active-session:user-1')?.expirationTtl).toBe(SESSION_TTL_SECONDS);
  });

  it('is null for a user with no pointer', async () => {
    const fake = makeFakeKv();
    expect(await new KvActiveSessionStore(fake.kv).getActive('ghost')).toBeNull();
  });

  it('overwrites: the last sign-in is the one that keeps the session', async () => {
    const fake = makeFakeKv();
    const store = new KvActiveSessionStore(fake.kv);

    await store.setActive('user-1', POINTER);
    await store.setActive('user-1', {
      sessionId: 'sess-2',
      deviceId: 'device-b',
      at: POINTER.at + 5,
    });

    expect(await store.getActive('user-1')).toEqual({
      sessionId: 'sess-2',
      deviceId: 'device-b',
      at: POINTER.at + 5,
    });
  });

  it('fails open on a pointer written in a shape this build cannot read', async () => {
    const fake = makeFakeKv();
    // A pointer missing sessionId can never become valid; it parses to null
    // rather than throwing, so one stale write costs a missed supersession, not
    // a crash on every request.
    await fake.kv.put('user-active-session:user-1', JSON.stringify({ deviceId: 'device-a' }));

    expect(await new KvActiveSessionStore(fake.kv).getActive('user-1')).toBeNull();
  });

  it('fails open on a value that is not JSON at all', async () => {
    const fake = makeFakeKv();
    await fake.kv.put('user-active-session:user-1', 'not json');

    expect(await new KvActiveSessionStore(fake.kv).getActive('user-1')).toBeNull();
  });
});
