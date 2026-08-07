import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { fakeIdGen } from '../../shared/id.ts';
import {
  ADMIN_USER,
  COMPANY_USER,
  fakeHashOf,
  makeFakeActiveSessions,
  makeFakeCompanies,
  makeFakeLimiter,
  makeFakePasswords,
  makeFakeSessions,
  makeFakeUsers,
} from './auth.fake.ts';
import { DUMMY_PASSWORD_HASH, LOGIN_BY_EMAIL_SCOPE, LOGIN_BY_IP_SCOPE } from './sign-in.ts';
import { makeSignInCompany, type SignInCompanyDeps } from './sign-in-company.ts';

const NOW = 1_770_000_000;
const PASSWORD = 'correct horse';
const IP_HASH = 'b1946ac92492d2347c6235b4d2611184';
const DEVICE_ID = 'device-web';

function setUp(overrides: { companyStatus?: string } = {}) {
  const users = makeFakeUsers([COMPANY_USER, ADMIN_USER]);
  const companies = makeFakeCompanies({ 'la-espiga': overrides.companyStatus ?? 'active' });
  const sessions = makeFakeSessions();
  const activeSessions = makeFakeActiveSessions();
  const limiter = makeFakeLimiter();
  const passwords = makeFakePasswords();

  const deps: SignInCompanyDeps = {
    users: users.users,
    companies: companies.companies,
    sessions: sessions.sessions,
    activeSessions: activeSessions.activeSessions,
    limiter: limiter.limiter,
    passwords: passwords.passwords,
    clock: fixedClock(NOW),
    ids: fakeIdGen({ tokens: ['sess-first', 'sess-second'] }),
  };

  return { deps, users, companies, sessions, activeSessions, limiter, passwords };
}

describe('a good password', () => {
  it('opens a session for the merchant administrator', async () => {
    const { deps, sessions } = setUp();

    const result = await makeSignInCompany(deps)({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sessionId).toBe('sess-first');
    expect(result.value.session).toEqual({
      userId: 'user-company',
      role: 'company',
      companyId: 'la-espiga',
      name: 'Ana P.',
      username: null,
      email: 'ana@laespiga.com',
      createdAt: NOW,
      shiftAckAt: NOW,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });
    expect(sessions.records.get('sess-first')).toEqual(result.value.session);
  });

  it('makes this the user one active session', async () => {
    const { deps, activeSessions } = setUp();

    await makeSignInCompany(deps)({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    // The pointer names the freshly minted session and the device that opened
    // it, so a later request on another device can find itself superseded.
    expect(activeSessions.pointers.get('user-company')).toEqual({
      sessionId: 'sess-first',
      deviceId: DEVICE_ID,
      at: NOW,
    });
  });

  it('starts the four-hour shift counter at the moment of signing in', async () => {
    const { deps } = setUp();

    const result = await makeSignInCompany(deps)({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    // Signing in *is* the first acknowledgement: whoever just typed the
    // password proved who is there, and greeting them with the prompt they
    // answered a second ago is noise.
    expect(result.ok && result.value.session.shiftAckAt).toBe(NOW);
  });

  it('mints a new session id every time and never reuses one', async () => {
    const { deps, sessions } = setUp();
    const signIn = makeSignInCompany(deps);
    const input = {
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    };

    const first = await signIn(input);
    const second = await signIn(input);

    expect(first.ok && first.value.sessionId).toBe('sess-first');
    expect(second.ok && second.value.sessionId).toBe('sess-second');
    expect([...sessions.records.keys()]).toEqual(['sess-first', 'sess-second']);
  });

  it('stamps last_login_at from the clock, never from Date.now()', async () => {
    const { deps, users } = setUp();

    await makeSignInCompany(deps)({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(users.lastLogins).toEqual([{ id: 'user-company', at: NOW }]);
  });

  it('folds the address to its canonical form before looking it up', async () => {
    const { deps, users } = setUp();

    const result = await makeSignInCompany(deps)({
      email: '  Ana@LaEspiga.com ',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(result.ok).toBe(true);
    expect(users.lookups).toEqual([{ by: 'email', key: 'ana@laespiga.com' }]);
  });

  it('clears the failed attempts standing against that address', async () => {
    const { deps, limiter } = setUp();

    await makeSignInCompany(deps)({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(limiter.resets).toEqual([{ scope: LOGIN_BY_EMAIL_SCOPE, key: 'ana@laespiga.com' }]);
  });

  it('leaves the by-IP counter alone: a whole shop is behind one address', async () => {
    const { deps, limiter } = setUp();

    await makeSignInCompany(deps)({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(limiter.resets.some((reset) => reset.scope === LOGIN_BY_IP_SCOPE)).toBe(false);
  });
});

describe('a refusal', () => {
  it('says invalid_credentials for a wrong password', async () => {
    const { deps, sessions } = setUp();

    const result = await makeSignInCompany(deps)({
      email: 'ana@laespiga.com',
      password: 'not it',
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(sessions.records.size).toBe(0);
  });

  it('says invalid_credentials for an address nobody has', async () => {
    const { deps } = setUp();

    const result = await makeSignInCompany(deps)({
      email: 'nobody@nowhere.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
  });

  it('hashes against a dummy when the account does not exist', async () => {
    const { deps, passwords } = setUp();

    await makeSignInCompany(deps)({
      email: 'nobody@nowhere.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    // This is the whole defence: without it the absent-account answer comes
    // back in a millisecond and the present-account one in a hundred, and a
    // stranger with a stopwatch has our customer list.
    expect(passwords.verified).toEqual([{ plaintext: PASSWORD, storedHash: DUMMY_PASSWORD_HASH }]);
  });

  it('costs the same call whether the account exists or not', async () => {
    const { deps, passwords } = setUp();
    const signIn = makeSignInCompany(deps);

    await signIn({
      email: 'ana@laespiga.com',
      password: 'wrong',
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });
    await signIn({
      email: 'ghost@nowhere.com',
      password: 'wrong',
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(passwords.verified).toHaveLength(2);
    expect(passwords.verified[0]?.storedHash).toBe(fakeHashOf(PASSWORD));
    expect(passwords.verified[1]?.storedHash).toBe(DUMMY_PASSWORD_HASH);
  });

  it('tells a platform admin nothing about having found the wrong door', async () => {
    const { deps } = setUp();

    const result = await makeSignInCompany(deps)({
      email: 'julio@cuadre.ve',
      password: 'platform pass',
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    // Correct password, wrong form. Answering anything else would enumerate
    // which addresses belong to the platform team.
    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
  });

  it('says account_disabled once the password is already proven', async () => {
    const users = makeFakeUsers([{ ...COMPANY_USER, status: 'disabled' }]);
    const { deps } = setUp();

    const result = await makeSignInCompany({ ...deps, users: users.users })({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(result).toEqual({ ok: false, error: 'account_disabled' });
  });

  it('says company_suspended rather than showing an empty panel', async () => {
    const { deps } = setUp({ companyStatus: 'suspended' });

    const result = await makeSignInCompany(deps)({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(result).toEqual({ ok: false, error: 'company_suspended' });
  });

  it('fails closed when the company cannot be read at all', async () => {
    const companies = makeFakeCompanies({});
    const { deps } = setUp();

    const result = await makeSignInCompany({ ...deps, companies: companies.companies })({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(result).toEqual({ ok: false, error: 'company_suspended' });
  });

  it('writes no session on any failure', async () => {
    const { deps, sessions, users } = setUp({ companyStatus: 'suspended' });

    await makeSignInCompany(deps)({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(sessions.records.size).toBe(0);
    expect(users.lastLogins).toEqual([]);
  });
});

describe('the rate limits', () => {
  it('refuses on the by-IP counter before touching the database', async () => {
    const { deps, limiter, users } = setUp();
    limiter.refuse(LOGIN_BY_IP_SCOPE);

    const result = await makeSignInCompany(deps)({
      email: 'ana@laespiga.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(result).toEqual({ ok: false, error: 'rate_limited' });
    expect(users.lookups).toEqual([]);
  });

  it('refuses on the by-address counter, keyed by what was typed', async () => {
    const { deps, limiter } = setUp();
    limiter.refuse(LOGIN_BY_EMAIL_SCOPE);

    const result = await makeSignInCompany(deps)({
      email: 'ghost@nowhere.com',
      password: PASSWORD,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    // Keyed by the address, not by the user it resolves to: an address nobody
    // has must be counted exactly like one that exists, or the limiter becomes
    // the oracle the dummy hash exists to close.
    expect(result).toEqual({ ok: false, error: 'rate_limited' });
    expect(limiter.hits.at(-1)).toMatchObject({
      scope: LOGIN_BY_EMAIL_SCOPE,
      key: 'ghost@nowhere.com',
    });
  });

  it('counts the address in its canonical form', async () => {
    const { deps, limiter } = setUp();

    await makeSignInCompany(deps)({
      email: 'ANA@laespiga.com',
      password: 'wrong',
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });

    expect(limiter.hits.map((hit) => hit.key)).toEqual([IP_HASH, 'ana@laespiga.com']);
  });
});
