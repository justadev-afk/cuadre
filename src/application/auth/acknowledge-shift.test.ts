import { describe, expect, it } from 'vitest';

import { SHIFT_CONFIRMATION_SECONDS } from '../../domain/shift.ts';
import { fixedClock } from '../../shared/clock.ts';
import type { StoredSession } from '../session.ts';
import { makeAcknowledgeShift } from './acknowledge-shift.ts';
import { makeFakeActiveSessions, makeFakeSessions } from './auth.fake.ts';
import { makeResolveSession } from './resolve-session.ts';

const SIGNED_IN_AT = 1_770_000_000;
const FOUR_HOURS_LATER = SIGNED_IN_AT + SHIFT_CONFIRMATION_SECONDS;

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
  deviceId: 'device-till',
};

describe('acknowledgeShift', () => {
  it('moves the stamp to now', async () => {
    const sessions = makeFakeSessions({ 'sess-1': STORED });
    const acknowledge = makeAcknowledgeShift({
      sessions: sessions.sessions,
      clock: fixedClock(FOUR_HOURS_LATER),
    });

    const session = await acknowledge({ sessionId: 'sess-1' });

    expect(session?.shiftAckAt).toBe(FOUR_HOURS_LATER);
    expect(sessions.records.get('sess-1')?.shiftAckAt).toBe(FOUR_HOURS_LATER);
  });

  it('silences the prompt for another four hours and no longer', async () => {
    const sessions = makeFakeSessions({ 'sess-1': STORED });
    await makeAcknowledgeShift({
      sessions: sessions.sessions,
      clock: fixedClock(FOUR_HOURS_LATER),
    })({ sessionId: 'sess-1' });

    // No pointer is seeded, so resolution fails open to 'active' — exactly the
    // path that carries `needsShiftConfirmation`.
    const activeSessions = makeFakeActiveSessions();
    const justInside = makeResolveSession({
      sessions: sessions.sessions,
      activeSessions: activeSessions.activeSessions,
      clock: fixedClock(FOUR_HOURS_LATER + SHIFT_CONFIRMATION_SECONDS - 1),
    });
    const justOutside = makeResolveSession({
      sessions: sessions.sessions,
      activeSessions: activeSessions.activeSessions,
      clock: fixedClock(FOUR_HOURS_LATER + SHIFT_CONFIRMATION_SECONDS),
    });

    const inside = await justInside({ sessionId: 'sess-1' });
    const outside = await justOutside({ sessionId: 'sess-1' });
    expect(inside.kind === 'active' && inside.active.needsShiftConfirmation).toBe(false);
    expect(outside.kind === 'active' && outside.active.needsShiftConfirmation).toBe(true);
  });

  it('leaves everything else about the session alone', async () => {
    const sessions = makeFakeSessions({ 'sess-1': STORED });

    const session = await makeAcknowledgeShift({
      sessions: sessions.sessions,
      clock: fixedClock(FOUR_HOURS_LATER),
    })({ sessionId: 'sess-1' });

    // Same person, same shop, same session id: this is a confirmation, not a
    // re-login.
    expect(session).toEqual({ ...STORED, role: 'cashier', shiftAckAt: FOUR_HOURS_LATER });
  });

  it('returns null when the session is already gone', async () => {
    const sessions = makeFakeSessions();

    const session = await makeAcknowledgeShift({
      sessions: sessions.sessions,
      clock: fixedClock(FOUR_HOURS_LATER),
    })({ sessionId: 'sess-1' });

    expect(session).toBeNull();
  });

  it('refuses to attribute a shift to a role this build does not know', async () => {
    const sessions = makeFakeSessions({ 'sess-1': { ...STORED, role: 'supervisor' } });

    const session = await makeAcknowledgeShift({
      sessions: sessions.sessions,
      clock: fixedClock(FOUR_HOURS_LATER),
    })({ sessionId: 'sess-1' });

    expect(session).toBeNull();
  });
});
