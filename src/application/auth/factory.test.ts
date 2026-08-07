import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { fakeIdGen } from '../../shared/id.ts';
import {
  CASHIER_USER,
  COMPANY_USER,
  makeFakeActiveSessions,
  makeFakeCompanies,
  makeFakeJobs,
  makeFakeLimiter,
  makeFakePasswords,
  makeFakeResets,
  makeFakeSessions,
  makeFakeUsers,
} from './auth.fake.ts';
import { type AuthDeps, makeAuthUseCases } from './factory.ts';

const NOW = 1_770_000_000;
const IP_HASH = 'b1946ac92492d2347c6235b4d2611184';

function setUp() {
  const users = makeFakeUsers([COMPANY_USER, CASHIER_USER]);
  const companies = makeFakeCompanies({ 'la-espiga': 'active' });
  const sessions = makeFakeSessions();
  const activeSessions = makeFakeActiveSessions();
  const limiter = makeFakeLimiter();
  const passwords = makeFakePasswords();
  const resets = makeFakeResets();
  const jobs = makeFakeJobs();

  const deps: AuthDeps = {
    users: users.users,
    companies: companies.companies,
    resets: resets.resets,
    sessions: sessions.sessions,
    activeSessions: activeSessions.activeSessions,
    limiter: limiter.limiter,
    passwords: passwords.passwords,
    jobs: jobs.jobs,
    clock: fixedClock(NOW),
    ids: fakeIdGen({ tokens: ['sess-1', 'sess-2', 'reset-token'] }),
    appBaseUrl: 'https://cuadre.jsansossio.com',
  };

  return { auth: makeAuthUseCases(deps), sessions, activeSessions, jobs };
}

describe('makeAuthUseCases', () => {
  it('builds every use case in the area', () => {
    const { auth } = setUp();

    expect(Object.keys(auth).sort()).toEqual([
      'acknowledgeShift',
      'requestPasswordReset',
      'resetPassword',
      'resolveSession',
      'signInAdmin',
      'signInCashier',
      'signInCompany',
      'signOut',
    ]);
  });

  it('hands every one of them the same collaborators', async () => {
    const { auth, sessions } = setUp();

    // Sign in through one use case, resolve and end the session through two
    // others: if the factory had built any of them over a different store,
    // this would not survive the round trip.
    const signedIn = await auth.signInCashier({
      companySlug: 'la-espiga',
      username: 'maria.r',
      pin: '8317',
      ipHash: IP_HASH,
      deviceId: 'device-a',
    });
    expect(signedIn.ok).toBe(true);
    if (!signedIn.ok) return;

    const resolved = await auth.resolveSession({ sessionId: signedIn.value.sessionId });
    expect(resolved.kind).toBe('active');
    if (resolved.kind !== 'active') return;
    expect(resolved.active.session.userId).toBe('user-cashier');
    expect(resolved.active.needsShiftConfirmation).toBe(false);

    const acknowledged = await auth.acknowledgeShift({ sessionId: signedIn.value.sessionId });
    expect(acknowledged?.shiftAckAt).toBe(NOW);

    await auth.signOut({ sessionId: signedIn.value.sessionId });
    expect(sessions.records.size).toBe(0);
  });

  it('supersedes the first device when the same user signs in on a second', async () => {
    const { auth } = setUp();
    const credentials = {
      companySlug: 'la-espiga',
      username: 'maria.r',
      pin: '8317',
      ipHash: IP_HASH,
    };

    // Device A signs in (sess-1), then device B signs in (sess-2).
    const onA = await auth.signInCashier({ ...credentials, deviceId: 'device-a' });
    const onB = await auth.signInCashier({ ...credentials, deviceId: 'device-b' });
    expect(onA.ok && onB.ok).toBe(true);
    if (!onA.ok || !onB.ok) return;

    // A is now superseded from another device; B is the live one.
    const afterB = await auth.resolveSession({ sessionId: onA.value.sessionId });
    expect(afterB).toEqual({ kind: 'superseded', sameDevice: false });
    expect((await auth.resolveSession({ sessionId: onB.value.sessionId })).kind).toBe('active');

    // Re-logging on device A (same device id, sess-... reused pool exhausted, so
    // this mints the reset-token id) points the user back at A and does not
    // surface as "signed in elsewhere" for the caller who just re-logged.
    const backOnA = await auth.signInCashier({ ...credentials, deviceId: 'device-a' });
    expect(backOnA.ok).toBe(true);
    if (!backOnA.ok) return;
    expect((await auth.resolveSession({ sessionId: backOnA.value.sessionId })).kind).toBe('active');
  });

  it('takes constructed collaborators, so a test needs no Worker around it', async () => {
    const { auth, jobs } = setUp();

    await auth.requestPasswordReset({ email: 'ana@laespiga.com', ipHash: IP_HASH });

    expect(jobs.enqueued).toHaveLength(1);
  });
});
