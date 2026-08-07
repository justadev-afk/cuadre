import { describe, expect, it } from 'vitest';

import type { StoredSession } from '../session.ts';
import { makeFakeSessions } from './auth.fake.ts';
import { makeSignOut } from './sign-out.ts';

const STORED: StoredSession = {
  userId: 'user-cashier',
  role: 'cashier',
  companyId: 'la-espiga',
  name: 'María R.',
  username: 'maria.r',
  email: null,
  createdAt: 1_770_000_000,
  shiftAckAt: 1_770_000_000,
  ipHash: 'b1946ac92492d2347c6235b4d2611184',
};

describe('signOut', () => {
  it('ends the session', async () => {
    const sessions = makeFakeSessions({ 'sess-1': STORED });

    await makeSignOut({ sessions: sessions.sessions })({ sessionId: 'sess-1' });

    expect(sessions.records.has('sess-1')).toBe(false);
  });

  it('leaves the same user signed in on their other devices', async () => {
    const sessions = makeFakeSessions({ 'sess-1': STORED, 'sess-2': STORED });

    await makeSignOut({ sessions: sessions.sessions })({ sessionId: 'sess-1' });

    // Signing out of the till at the front counter must not end the shift at
    // the one in the back.
    expect([...sessions.records.keys()]).toEqual(['sess-2']);
  });

  it('is content with a session that is already gone', async () => {
    const sessions = makeFakeSessions();

    await expect(
      makeSignOut({ sessions: sessions.sessions })({ sessionId: 'sess-1' }),
    ).resolves.toBeUndefined();
  });
});
