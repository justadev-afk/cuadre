import { describe, expect, it } from 'vitest';

import { SHIFT_CONFIRMATION_SECONDS } from '../../domain/shift.ts';
import { fixedClock } from '../../shared/clock.ts';
import type { ActiveSessionPointer, StoredSession } from '../session.ts';
import { makeFakeActiveSessions, makeFakeSessions } from './auth.fake.ts';
import { type AccountStanding, makeResolveSession } from './resolve-session.ts';

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

/** The user behind `STORED`, present and allowed in — the ordinary case. */
const STANDING: AccountStanding = {
  status: 'active',
  companyId: 'la-espiga',
  companyStatus: 'active',
};

function resolveAt(
  now: number,
  stored: StoredSession = STORED,
  pointer: ActiveSessionPointer | null = POINTS_AT_SESS_1,
  /** What the users table says about them. `null` is a row that is gone. */
  standing: AccountStanding | null = STANDING,
) {
  const sessions = makeFakeSessions({ 'sess-1': stored });
  const active = makeFakeActiveSessions(pointer === null ? {} : { [stored.userId]: pointer });
  const asked: string[] = [];
  const resolve = makeResolveSession({
    sessions: sessions.sessions,
    activeSessions: active.activeSessions,
    users: {
      async findStanding(userId) {
        asked.push(userId);
        return standing;
      },
    },
    clock: fixedClock(now),
  });
  return { sessions, active, asked, resolve };
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

  // The four-hour prompt is switched off (`SHIFT_CONFIRMATION_ENABLED`). The
  // rule behind it is still specified, in `domain/shift.test.ts`; what belongs
  // here is what a session actually resolves to while the switch is off, and
  // that is: never asked, and never signed out for it.
  it('never asks for a shift confirmation, however long the shift runs', async () => {
    for (const elapsed of [3600, SHIFT_CONFIRMATION_SECONDS, SHIFT_CONFIRMATION_SECONDS * 3]) {
      const { resolve } = resolveAt(SIGNED_IN_AT + elapsed);

      const resolved = await resolve({ sessionId: 'sess-1' });
      expect(resolved.kind === 'active' && resolved.active.needsShiftConfirmation).toBe(false);
    }
  });

  it('leaves a long-running session exactly where it was', async () => {
    const { resolve, sessions } = resolveAt(SIGNED_IN_AT + SHIFT_CONFIRMATION_SECONDS * 3);

    const resolved = await resolve({ sessionId: 'sess-1' });

    // Twelve hours in and nothing has interrupted the till or ended it: a shift
    // lasts what it lasts.
    expect(resolved.kind).toBe('active');
    if (resolved.kind !== 'active') return;
    expect(resolved.active.session.userId).toBe('user-cashier');
    expect(sessions.records.has('sess-1')).toBe(true);
  });

  it('is nobody, not somebody reduced, when the stored role no longer exists', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT, { ...STORED, role: 'supervisor' });

    expect(await resolve({ sessionId: 'sess-1' })).toEqual({ kind: 'anonymous' });
  });
});

/**
 * The bug this whole check exists for: a cashier was deleted and kept working.
 * Ending their sessions at the moment of deletion is a KV list of a reverse
 * index, and a session whose index key was never written survives it. The row
 * is the only thing that cannot lie.
 */
describe('the account behind the session', () => {
  it('revokes a session whose user row is gone, and deletes the record', async () => {
    const { resolve, sessions } = resolveAt(SIGNED_IN_AT + 60, STORED, POINTS_AT_SESS_1, null);

    expect(await resolve({ sessionId: 'sess-1' })).toEqual({ kind: 'revoked' });
    // Not left for the thirty-day TTL: it is a live credential for nobody.
    expect(sessions.records.has('sess-1')).toBe(false);
  });

  it('revokes a session whose user was disabled instead of deleted', async () => {
    // The other ending of `deleteEmployee`: a cashier with history keeps their
    // row and loses their access. From the till it must look identical.
    const { resolve } = resolveAt(SIGNED_IN_AT + 60, STORED, POINTS_AT_SESS_1, {
      ...STANDING,
      status: 'disabled',
    });

    expect(await resolve({ sessionId: 'sess-1' })).toEqual({ kind: 'revoked' });
  });

  it('revokes a session whose company was suspended', async () => {
    const { resolve } = resolveAt(SIGNED_IN_AT + 60, STORED, POINTS_AT_SESS_1, {
      ...STANDING,
      companyStatus: 'suspended',
    });

    expect(await resolve({ sessionId: 'sess-1' })).toEqual({ kind: 'revoked' });
  });

  it('revokes a merchant user whose company row has vanished', async () => {
    // `companyStatus: null` means two different things — a platform admin with
    // no company, and a merchant user pointing at a company that is not there.
    // Only the first may stay signed in.
    const { resolve } = resolveAt(SIGNED_IN_AT + 60, STORED, POINTS_AT_SESS_1, {
      ...STANDING,
      companyStatus: null,
    });

    expect(await resolve({ sessionId: 'sess-1' })).toEqual({ kind: 'revoked' });
  });

  it('keeps a platform admin, who has no company to be suspended', async () => {
    const admin: StoredSession = {
      ...STORED,
      userId: 'user-admin',
      role: 'admin',
      companyId: null,
      username: null,
      email: 'julio@cuadre.ve',
    };
    const { resolve } = resolveAt(
      SIGNED_IN_AT + 60,
      admin,
      { ...POINTS_AT_SESS_1 },
      { status: 'active', companyId: null, companyStatus: null },
    );

    expect((await resolve({ sessionId: 'sess-1' })).kind).toBe('active');
  });

  it('asks about the user the record names, never one the caller supplied', async () => {
    const { resolve, asked } = resolveAt(SIGNED_IN_AT + 60);

    await resolve({ sessionId: 'sess-1' });

    expect(asked).toEqual(['user-cashier']);
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
