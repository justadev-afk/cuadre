import { describe, expect, it } from 'vitest';

import { MAX_PIN_ATTEMPTS_PER_HOUR } from '../../domain/credentials.ts';
import { fixedClock } from '../../shared/clock.ts';
import { fakeIdGen } from '../../shared/id.ts';
import {
  CASHIER_USER,
  COMPANY_USER,
  makeFakeActiveSessions,
  makeFakeCompanies,
  makeFakeLimiter,
  makeFakePasswords,
  makeFakeSessions,
  makeFakeUsers,
} from './auth.fake.ts';
import { DUMMY_PASSWORD_HASH, LOGIN_BY_IP_SCOPE } from './sign-in.ts';
import {
  makeSignInCashier,
  PIN_ATTEMPTS,
  PIN_SCOPE,
  type SignInCashierDeps,
} from './sign-in-cashier.ts';

const NOW = 1_770_000_000;
const PIN = '8317';
const IP_HASH = 'b1946ac92492d2347c6235b4d2611184';
const DEVICE_ID = 'device-till';

function setUp(overrides: { companyStatus?: string } = {}) {
  const users = makeFakeUsers([CASHIER_USER, COMPANY_USER]);
  const companies = makeFakeCompanies({ 'la-espiga': overrides.companyStatus ?? 'active' });
  const sessions = makeFakeSessions();
  const activeSessions = makeFakeActiveSessions();
  const limiter = makeFakeLimiter();
  const passwords = makeFakePasswords();

  const deps: SignInCashierDeps = {
    users: users.users,
    companies: companies.companies,
    sessions: sessions.sessions,
    activeSessions: activeSessions.activeSessions,
    limiter: limiter.limiter,
    passwords: passwords.passwords,
    clock: fixedClock(NOW),
    ids: fakeIdGen({ tokens: ['sess-till'] }),
  };

  return { deps, users, companies, sessions, activeSessions, limiter, passwords };
}

const GOOD = {
  companySlug: 'la-espiga',
  username: 'maria.r',
  pin: PIN,
  ipHash: IP_HASH,
  deviceId: DEVICE_ID,
};

describe('the counter door', () => {
  it('opens a session for the cashier', async () => {
    const { deps, sessions } = setUp();

    const result = await makeSignInCashier(deps)(GOOD);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.sessionId).toBe('sess-till');
    expect(result.value.session).toEqual({
      userId: 'user-cashier',
      role: 'cashier',
      companyId: 'la-espiga',
      name: 'María R.',
      username: 'maria.r',
      email: null,
      createdAt: NOW,
      shiftAckAt: NOW,
      lastSeenAt: NOW,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });
    expect(sessions.records.get('sess-till')).toEqual(result.value.session);
  });

  it('makes this the cashier one active session', async () => {
    const { deps, activeSessions } = setUp();

    await makeSignInCashier(deps)(GOOD);

    expect(activeSessions.pointers.get('user-cashier')).toEqual({
      sessionId: 'sess-till',
      deviceId: DEVICE_ID,
      at: NOW,
    });
  });

  it('looks the cashier up by the tuple that was typed on the screen', async () => {
    const { deps, users } = setUp();

    await makeSignInCashier(deps)(GOOD);

    // `company_id` is the slug, so the WHERE is the login form.
    expect(users.lookups).toEqual([{ by: 'login', key: 'la-espiga:maria.r' }]);
  });

  it('normalises what a human typed into the slug the key actually is', async () => {
    const { deps, users } = setUp();

    const result = await makeSignInCashier(deps)({
      ...GOOD,
      companySlug: '  La Espiga ',
      username: 'Maria.R',
    });

    expect(result.ok).toBe(true);
    expect(users.lookups).toEqual([{ by: 'login', key: 'la-espiga:maria.r' }]);
  });

  it('scopes the company check by the same slug', async () => {
    const { deps, companies } = setUp();

    await makeSignInCashier(deps)(GOOD);

    expect(companies.lookups).toEqual(['la-espiga']);
  });

  it('stamps the shift counter at sign-in', async () => {
    const { deps } = setUp();

    const result = await makeSignInCashier(deps)(GOOD);

    expect(result.ok && result.value.session.shiftAckAt).toBe(NOW);
  });
});

describe('a refusal', () => {
  it('says invalid_credentials for a wrong PIN', async () => {
    const { deps, sessions } = setUp();

    const result = await makeSignInCashier(deps)({ ...GOOD, pin: '9999' });

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(sessions.records.size).toBe(0);
  });

  it('hashes against a dummy for a username nobody has', async () => {
    const { deps, passwords } = setUp();

    const result = await makeSignInCashier(deps)({ ...GOOD, username: 'ghost' });

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(passwords.verified).toEqual([{ plaintext: PIN, storedHash: DUMMY_PASSWORD_HASH }]);
  });

  it('hashes against a dummy for a company nobody has', async () => {
    const { deps, passwords } = setUp();

    const result = await makeSignInCashier(deps)({ ...GOOD, companySlug: 'no-such-shop' });

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(passwords.verified.at(-1)?.storedHash).toBe(DUMMY_PASSWORD_HASH);
  });

  it('refuses a slug that cannot name a company without touching anything', async () => {
    const { deps, users, limiter } = setUp();

    const result = await makeSignInCashier(deps)({ ...GOOD, companySlug: '!!' });

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(users.lookups).toEqual([]);
    expect(limiter.hits).toEqual([]);
  });

  it('refuses a username that cannot be one either', async () => {
    const { deps, users } = setUp();

    const result = await makeSignInCashier(deps)({ ...GOOD, username: 'a' });

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(users.lookups).toEqual([]);
  });

  it('keeps the counter a cashier door if a merchant ever gets a username', async () => {
    const users = makeFakeUsers([{ ...COMPANY_USER, username: 'ana.p' }]);
    const { deps } = setUp();

    const result = await makeSignInCashier({ ...deps, users: users.users })({
      ...GOOD,
      username: 'ana.p',
      pin: 'correct horse',
    });

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
  });

  it('says account_disabled for a cashier who no longer works here', async () => {
    const users = makeFakeUsers([{ ...CASHIER_USER, status: 'disabled' }]);
    const { deps } = setUp();

    const result = await makeSignInCashier({ ...deps, users: users.users })(GOOD);

    expect(result).toEqual({ ok: false, error: 'account_disabled' });
  });

  it('says company_suspended when the shop is', async () => {
    const { deps } = setUp({ companyStatus: 'suspended' });

    const result = await makeSignInCashier(deps)(GOOD);

    expect(result).toEqual({ ok: false, error: 'company_suspended' });
  });
});

describe('the PIN cap', () => {
  it('is the number the domain owns, over an hour', async () => {
    const { deps, limiter } = setUp();

    await makeSignInCashier(deps)(GOOD);

    expect(PIN_ATTEMPTS).toEqual({ limit: MAX_PIN_ATTEMPTS_PER_HOUR, windowSeconds: 3600 });
    expect(limiter.hits.at(-1)).toEqual({
      scope: PIN_SCOPE,
      key: 'la-espiga:maria.r',
      policy: PIN_ATTEMPTS,
    });
  });

  it('counts guesses at a username that does not exist', async () => {
    const { deps, limiter } = setUp();
    const signIn = makeSignInCashier(deps);

    for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS_PER_HOUR; attempt++) {
      await signIn({ ...GOOD, username: 'ghost', pin: '9999' });
    }
    const oneTooMany = await signIn({ ...GOOD, username: 'ghost', pin: '9999' });

    // Five an hour is what makes four digits defensible. If a username nobody
    // has were free to guess against, an attacker would simply enumerate
    // usernames instead.
    expect(oneTooMany).toEqual({ ok: false, error: 'rate_limited' });
    expect(limiter.hits.filter((hit) => hit.scope === PIN_SCOPE)).toHaveLength(
      MAX_PIN_ATTEMPTS_PER_HOUR + 1,
    );
  });

  it('locks the tuple, not the till: a second cashier still gets in', async () => {
    const { deps, limiter } = setUp();
    const signIn = makeSignInCashier(deps);
    limiter.refuse(PIN_SCOPE);

    const refused = await signIn(GOOD);

    expect(refused).toEqual({ ok: false, error: 'rate_limited' });
    expect(limiter.hits.at(-1)?.key).toBe('la-espiga:maria.r');
  });

  it('clears the failed attempts once the right PIN arrives', async () => {
    const { deps, limiter } = setUp();
    const signIn = makeSignInCashier(deps);

    await signIn({ ...GOOD, pin: '9999' });
    await signIn(GOOD);

    expect(limiter.resets).toEqual([{ scope: PIN_SCOPE, key: 'la-espiga:maria.r' }]);
  });

  it('refuses on the by-IP counter before any lookup', async () => {
    const { deps, limiter, users } = setUp();
    limiter.refuse(LOGIN_BY_IP_SCOPE);

    const result = await makeSignInCashier(deps)(GOOD);

    expect(result).toEqual({ ok: false, error: 'rate_limited' });
    expect(users.lookups).toEqual([]);
  });
});
