import { describe, expect, it } from 'vitest';

import { SHIFT_CONFIRMATION_SECONDS, shiftWindowElapsed } from '../../domain/shift.ts';
import { fixedClock } from '../../shared/clock.ts';
import type { StoredSession } from '../session.ts';
import { makeAcknowledgeShift } from './acknowledge-shift.ts';
import { makeFakeSessions } from './auth.fake.ts';

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

  it('silences the rule for another four hours and no longer', async () => {
    const sessions = makeFakeSessions({ 'sess-1': STORED });
    await makeAcknowledgeShift({
      sessions: sessions.sessions,
      clock: fixedClock(FOUR_HOURS_LATER),
    })({ sessionId: 'sess-1' });

    // Read against the rule rather than through `resolveSession`: the prompt is
    // switched off (`SHIFT_CONFIRMATION_ENABLED`), so the resolve path answers
    // `false` at every instant and can no longer tell these two apart. What this
    // use case is responsible for — where the stamp lands, and so when the
    // window would reopen — is the same in both positions of the switch.
    const stamped = sessions.records.get('sess-1')?.shiftAckAt ?? 0;
    expect(stamped).toBe(FOUR_HOURS_LATER);
    expect(
      shiftWindowElapsed({ shiftAckAt: stamped, now: stamped + SHIFT_CONFIRMATION_SECONDS - 1 }),
    ).toBe(false);
    expect(
      shiftWindowElapsed({ shiftAckAt: stamped, now: stamped + SHIFT_CONFIRMATION_SECONDS }),
    ).toBe(true);
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
