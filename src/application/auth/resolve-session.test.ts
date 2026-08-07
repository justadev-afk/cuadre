import { describe, expect, it } from 'vitest';

import { SHIFT_CONFIRMATION_SECONDS } from '../../domain/shift.ts';
import { fixedClock } from '../../shared/clock.ts';
import type { StoredSession } from '../session.ts';
import { makeFakeSessions } from './auth.fake.ts';
import { makeResolveSession } from './resolve-session.ts';

const SIGNED_IN_AT = 1_770_000_000;

const STORED: StoredSession = {
  userId: 'user-cashier',
  role: 'cashier',
  companyId: 'la-espiga',
  name: 'María R.',
  username: 'maria.r',
  email: null,
  createdAt: SIGNED_IN_AT,
  shiftAckAt: SIGNED_IN_AT,
  ipHash: 'b1946ac92492d2347c6235b4d2611184',
};

function resolveAt(now: number, stored: StoredSession = STORED) {
  const sessions = makeFakeSessions({ 'sess-1': stored });
  const resolve = makeResolveSession({ sessions: sessions.sessions, clock: fixedClock(now) });
  return { sessions, resolve };
}

describe('resolveSession', () => {
  it('returns the session for a live id', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT + 60);

    const resolved = await resolve({ sessionId: 'sess-1' });

    expect(resolved?.sessionId).toBe('sess-1');
    expect(resolved?.session).toEqual(STORED);
  });

  it('returns null for an id the store does not know', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT);

    expect(await resolve({ sessionId: 'nope' })).toBeNull();
  });

  it('renews the sliding TTL by reading through touch', async () => {
    const { resolve, sessions } = resolveAt(SIGNED_IN_AT);

    await resolve({ sessionId: 'sess-1' });

    // A session never expires on its own: every authenticated request is what
    // pushes the window out again.
    expect(sessions.touched).toEqual(['sess-1']);
  });

  it('does not ask for a shift confirmation an hour in', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT + 3600);

    expect((await resolve({ sessionId: 'sess-1' }))?.needsShiftConfirmation).toBe(false);
  });

  it('asks for one at exactly four hours', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT + SHIFT_CONFIRMATION_SECONDS);

    expect((await resolve({ sessionId: 'sess-1' }))?.needsShiftConfirmation).toBe(true);
  });

  it('keeps asking, and never signs anyone out for not answering', async () => {
    const { resolve, sessions } = resolveAt(SIGNED_IN_AT + SHIFT_CONFIRMATION_SECONDS * 3);

    const resolved = await resolve({ sessionId: 'sess-1' });

    expect(resolved?.needsShiftConfirmation).toBe(true);
    expect(resolved?.session.userId).toBe('user-cashier');
    expect(sessions.records.has('sess-1')).toBe(true);
  });

  it('reads the counter off the record, not off the client', async () => {
    // Acknowledged an hour ago on a session opened five hours ago: reloading
    // the page or opening a second tab cannot move this number.
    const { resolve } = resolveAt(SIGNED_IN_AT + 5 * 3600, {
      ...STORED,
      shiftAckAt: SIGNED_IN_AT + 4 * 3600,
    });

    expect((await resolve({ sessionId: 'sess-1' }))?.needsShiftConfirmation).toBe(false);
  });

  it('is nobody, not somebody reduced, when the stored role no longer exists', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT, { ...STORED, role: 'supervisor' });

    expect(await resolve({ sessionId: 'sess-1' })).toBeNull();
  });
});
