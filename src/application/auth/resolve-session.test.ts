import { describe, expect, it } from 'vitest';

import { SHIFT_CONFIRMATION_SECONDS } from '../../domain/shift.ts';
import { fixedClock } from '../../shared/clock.ts';
import type { ActiveSessionPointer, StoredSession } from '../session.ts';
import { makeFakeActiveSessions, makeFakeSessions } from './auth.fake.ts';
import { makeResolveSession } from './resolve-session.ts';

const SIGNED_IN_AT = 1_770_000_000;
const DEVICE_A = 'device-a';

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
  deviceId: DEVICE_A,
};

/** By default the pointer names sess-1 on the same device — a plain active session. */
const POINTS_AT_SESS_1: ActiveSessionPointer = {
  sessionId: 'sess-1',
  deviceId: DEVICE_A,
  at: SIGNED_IN_AT,
};

function resolveAt(
  now: number,
  stored: StoredSession = STORED,
  pointer: ActiveSessionPointer | null = POINTS_AT_SESS_1,
) {
  const sessions = makeFakeSessions({ 'sess-1': stored });
  const active = makeFakeActiveSessions(pointer === null ? {} : { [stored.userId]: pointer });
  const resolve = makeResolveSession({
    sessions: sessions.sessions,
    activeSessions: active.activeSessions,
    clock: fixedClock(now),
  });
  return { sessions, active, resolve };
}

describe('resolveSession', () => {
  it('returns the session for a live id the pointer still names', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT + 60);

    const resolved = await resolve({ sessionId: 'sess-1' });

    expect(resolved.kind).toBe('active');
    if (resolved.kind !== 'active') return;
    expect(resolved.active.sessionId).toBe('sess-1');
    expect(resolved.active.session).toEqual(STORED);
  });

  it('is anonymous for an id the store does not know', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT);

    expect(await resolve({ sessionId: 'nope' })).toEqual({ kind: 'anonymous' });
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

    const resolved = await resolve({ sessionId: 'sess-1' });
    expect(resolved.kind === 'active' && resolved.active.needsShiftConfirmation).toBe(false);
  });

  it('asks for one at exactly four hours', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT + SHIFT_CONFIRMATION_SECONDS);

    const resolved = await resolve({ sessionId: 'sess-1' });
    expect(resolved.kind === 'active' && resolved.active.needsShiftConfirmation).toBe(true);
  });

  it('keeps asking, and never signs anyone out for not answering', async () => {
    const { resolve, sessions } = resolveAt(SIGNED_IN_AT + SHIFT_CONFIRMATION_SECONDS * 3);

    const resolved = await resolve({ sessionId: 'sess-1' });

    expect(resolved.kind).toBe('active');
    if (resolved.kind !== 'active') return;
    expect(resolved.active.needsShiftConfirmation).toBe(true);
    expect(resolved.active.session.userId).toBe('user-cashier');
    expect(sessions.records.has('sess-1')).toBe(true);
  });

  it('reads the counter off the record, not off the client', async () => {
    // Acknowledged an hour ago on a session opened five hours ago: reloading
    // the page or opening a second tab cannot move this number.
    const { resolve } = resolveAt(SIGNED_IN_AT + 5 * 3600, {
      ...STORED,
      shiftAckAt: SIGNED_IN_AT + 4 * 3600,
    });

    const resolved = await resolve({ sessionId: 'sess-1' });
    expect(resolved.kind === 'active' && resolved.active.needsShiftConfirmation).toBe(false);
  });

  it('is nobody, not somebody reduced, when the stored role no longer exists', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT, { ...STORED, role: 'supervisor' });

    expect(await resolve({ sessionId: 'sess-1' })).toEqual({ kind: 'anonymous' });
  });
});

describe('one active session', () => {
  it('is active when no pointer exists yet (fails open)', async () => {
    // A session kept continuously alive can outlive its pointer's TTL; a null
    // pointer means nothing newer exists, so it is not superseded.
    const { resolve } = resolveAt(SIGNED_IN_AT + 60, STORED, null);

    const resolved = await resolve({ sessionId: 'sess-1' });
    expect(resolved.kind).toBe('active');
  });

  it('is superseded when the pointer names a different session on another device', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT + 60, STORED, {
      sessionId: 'sess-2',
      deviceId: 'device-b',
      at: SIGNED_IN_AT + 30,
    });

    const resolved = await resolve({ sessionId: 'sess-1' });

    expect(resolved).toEqual({ kind: 'superseded', sameDevice: false });
  });

  it('is superseded but same-device when the newer session shares the device id', async () => {
    // Signed in again on the same browser: still superseded (the old id no
    // longer works), but the modal must not claim it was "another device".
    const { resolve } = resolveAt(SIGNED_IN_AT + 60, STORED, {
      sessionId: 'sess-2',
      deviceId: DEVICE_A,
      at: SIGNED_IN_AT + 30,
    });

    const resolved = await resolve({ sessionId: 'sess-1' });

    expect(resolved).toEqual({ kind: 'superseded', sameDevice: true });
  });

  it('stays active when the pointer names this very session', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT + 60, STORED, POINTS_AT_SESS_1);

    const resolved = await resolve({ sessionId: 'sess-1' });
    expect(resolved.kind).toBe('active');
  });
});
