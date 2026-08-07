import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { fakeIdGen } from '../../shared/id.ts';
import {
  ADMIN_USER,
  COMPANY_USER,
  makeFakeCompanies,
  makeFakeLimiter,
  makeFakePasswords,
  makeFakeSessions,
  makeFakeUsers,
} from './auth.fake.ts';
import { DUMMY_PASSWORD_HASH } from './sign-in.ts';
import { makeSignInAdmin, type SignInAdminDeps } from './sign-in-admin.ts';

const NOW = 1_770_000_000;
const IP_HASH = 'b1946ac92492d2347c6235b4d2611184';

function setUp() {
  const users = makeFakeUsers([ADMIN_USER, COMPANY_USER]);
  const companies = makeFakeCompanies({ 'la-espiga': 'active' });
  const sessions = makeFakeSessions();
  const limiter = makeFakeLimiter();
  const passwords = makeFakePasswords();

  const deps: SignInAdminDeps = {
    users: users.users,
    companies: companies.companies,
    sessions: sessions.sessions,
    limiter: limiter.limiter,
    passwords: passwords.passwords,
    clock: fixedClock(NOW),
    ids: fakeIdGen({ tokens: ['sess-admin'] }),
  };

  return { deps, users, companies, sessions, limiter, passwords };
}

describe('the platform door', () => {
  it('opens a session with no company at all', async () => {
    const { deps, sessions } = setUp();

    const result = await makeSignInAdmin(deps)({
      email: 'julio@cuadre.ve',
      password: 'platform pass',
      ipHash: IP_HASH,
    });

    expect(result.ok && result.value.session.role).toBe('admin');
    expect(result.ok && result.value.session.companyId).toBeNull();
    expect(sessions.records.get('sess-admin')?.userId).toBe('user-admin');
  });

  it('reads no company for an admin, because an admin has none', async () => {
    const { deps, companies } = setUp();

    await makeSignInAdmin(deps)({
      email: 'julio@cuadre.ve',
      password: 'platform pass',
      ipHash: IP_HASH,
    });

    expect(companies.lookups).toEqual([]);
  });

  it('refuses a merchant with a perfectly good password', async () => {
    const { deps, sessions } = setUp();

    const result = await makeSignInAdmin(deps)({
      email: 'ana@laespiga.com',
      password: 'correct horse',
      ipHash: IP_HASH,
    });

    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(sessions.records.size).toBe(0);
  });

  it('hashes against the dummy for an unknown address, exactly as the other door does', async () => {
    const { deps, passwords } = setUp();

    const result = await makeSignInAdmin(deps)({
      email: 'nobody@cuadre.ve',
      password: 'platform pass',
      ipHash: IP_HASH,
    });

    // The two doors have to be indistinguishable to anything that is not an
    // admin — same vocabulary, same work, same silence.
    expect(result).toEqual({ ok: false, error: 'invalid_credentials' });
    expect(passwords.verified.at(-1)?.storedHash).toBe(DUMMY_PASSWORD_HASH);
  });

  it('says account_disabled for a suspended member of the team', async () => {
    const users = makeFakeUsers([{ ...ADMIN_USER, status: 'disabled' }]);
    const { deps } = setUp();

    const result = await makeSignInAdmin({ ...deps, users: users.users })({
      email: 'julio@cuadre.ve',
      password: 'platform pass',
      ipHash: IP_HASH,
    });

    expect(result).toEqual({ ok: false, error: 'account_disabled' });
  });
});
