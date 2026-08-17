import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { sha256Hex } from '../../shared/crypto.ts';
import { fakeIdGen } from '../../shared/id.ts';
import type { StoredSession } from '../session.ts';
import {
  COMPANY_USER,
  type FakeResetRow,
  fakeHashOf,
  makeFakeActiveSessions,
  makeFakeCompanies,
  makeFakePasswords,
  makeFakeResets,
  makeFakeSessions,
  makeFakeUsers,
} from './auth.fake.ts';
import { makeResetPassword, type ResetPasswordDeps } from './reset-password.ts';

const NOW = 1_770_000_000;
const TOKEN = 'a3f1c0de';
const NEW_PASSWORD = 'una clave nueva';
const IP_HASH = 'b1946ac92492d2347c6235b4d2611184';
const DEVICE_ID = 'device-web';

const SESSION: StoredSession = {
  userId: COMPANY_USER.id,
  role: 'company',
  companyId: 'la-espiga',
  name: 'Ana P.',
  username: null,
  email: 'ana@laespiga.com',
  createdAt: NOW - 3600,
  shiftAckAt: NOW - 3600,
  ipHash: IP_HASH,
  deviceId: 'device-old',
};

/** Everything the use case takes but the token and the password. */
const REQUEST = { token: TOKEN, newPassword: NEW_PASSWORD, ipHash: IP_HASH, deviceId: DEVICE_ID };

async function setUp(
  overrides: Partial<FakeResetRow> = {},
  world: { user?: Partial<typeof COMPANY_USER>; companyStatus?: string } = {},
) {
  const tokenHash = await sha256Hex(TOKEN);
  const users = makeFakeUsers([{ ...COMPANY_USER, ...world.user }]);
  const companies = makeFakeCompanies({ 'la-espiga': world.companyStatus ?? 'active' });
  const resets = makeFakeResets([
    {
      tokenHash,
      userId: COMPANY_USER.id,
      expiresAt: NOW + 600,
      usedAt: null,
      requestedIpHash: null,
      createdAt: NOW - 600,
      ...overrides,
    },
  ]);
  const sessions = makeFakeSessions({ 'sess-1': SESSION, 'sess-2': SESSION });
  const activeSessions = makeFakeActiveSessions();
  const passwords = makeFakePasswords();

  const deps: ResetPasswordDeps = {
    resets: resets.resets,
    users: users.users,
    companies: companies.companies,
    sessions: sessions.sessions,
    activeSessions: activeSessions.activeSessions,
    passwords: passwords.passwords,
    clock: fixedClock(NOW),
    ids: fakeIdGen({ tokens: ['sess-fresh'] }),
  };

  return { deps, users, companies, resets, sessions, activeSessions, passwords, tokenHash };
}

describe('spending a good link', () => {
  it('sets the new password', async () => {
    const { deps, users } = await setUp();

    const result = await makeResetPassword(deps)(REQUEST);

    expect(result.ok).toBe(true);
    expect(users.rows[0]?.passwordHash).toBe(fakeHashOf(NEW_PASSWORD));
  });

  it('looks the token up by its SHA-256 and never by itself', async () => {
    const { deps, resets, tokenHash } = await setUp();

    await makeResetPassword(deps)(REQUEST);

    // The database holds hashes, so a dump of `password_resets` is a list of
    // dead strings rather than a list of live links.
    expect(resets.lookups).toEqual([tokenHash]);
    expect(resets.lookups).not.toContain(TOKEN);
  });

  it('spends the link', async () => {
    const { deps, resets, tokenHash } = await setUp();

    await makeResetPassword(deps)(REQUEST);

    expect(resets.rows.get(tokenHash)?.usedAt).toBe(NOW);
  });

  it('refuses the second click on the same link', async () => {
    const { deps } = await setUp();
    const reset = makeResetPassword(deps);

    const first = await reset(REQUEST);
    const second = await reset({ ...REQUEST, newPassword: 'otra clave nueva' });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('closes every session that user had anywhere', async () => {
    const { deps, sessions } = await setUp();

    await makeResetPassword(deps)(REQUEST);

    // A password is reset because somebody else might have had the old one.
    // Leaving the tab they were already signed in on alive answers the wrong
    // half of that — only the session this reset just opened survives.
    expect([...sessions.records.keys()]).toEqual(['sess-fresh']);
  });

  it('signs the browser in with a session of its own', async () => {
    const { deps, sessions, activeSessions } = await setUp();

    const result = await makeResetPassword(deps)(REQUEST);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Somebody who just proved they own the address does not get sent back to
    // a form to type the password they chose ten seconds ago.
    expect(result.value?.sessionId).toBe('sess-fresh');
    expect(result.value?.session).toMatchObject({
      userId: COMPANY_USER.id,
      role: 'company',
      companyId: 'la-espiga',
      createdAt: NOW,
      shiftAckAt: NOW,
      ipHash: IP_HASH,
      deviceId: DEVICE_ID,
    });
    expect(sessions.records.get('sess-fresh')).toBeDefined();
    // And it becomes the one active session, so the device that held the old
    // password is superseded rather than merely closed.
    expect(activeSessions.pointers.get(COMPANY_USER.id)).toEqual({
      sessionId: 'sess-fresh',
      deviceId: DEVICE_ID,
      at: NOW,
    });
  });

  it('burns any other link the same person was holding', async () => {
    const { deps, resets } = await setUp();
    await resets.resets.create({
      tokenHash: 'another-hash',
      userId: COMPANY_USER.id,
      expiresAt: NOW + 600,
      requestedIpHash: null,
      createdAt: NOW - 300,
    });

    await makeResetPassword(deps)(REQUEST);

    expect(resets.rows.get('another-hash')?.usedAt).toBe(NOW);
  });
});

describe('a reset that may not open a session', () => {
  it('changes the password of a disabled account but signs nobody in', async () => {
    const { deps, users, sessions } = await setUp({}, { user: { status: 'disabled' } });

    const result = await makeResetPassword(deps)(REQUEST);

    // The link worked; the account is the thing that may not be in the app.
    // The login door is what says so, in the vocabulary it already has.
    expect(result).toEqual({ ok: true, value: null });
    expect(users.rows[0]?.passwordHash).toBe(fakeHashOf(NEW_PASSWORD));
    expect(sessions.records.size).toBe(0);
  });

  it('signs nobody in when the company is suspended', async () => {
    const { deps, users } = await setUp({}, { companyStatus: 'suspended' });

    const result = await makeResetPassword(deps)(REQUEST);

    expect(result).toEqual({ ok: true, value: null });
    expect(users.rows[0]?.passwordHash).toBe(fakeHashOf(NEW_PASSWORD));
  });

  it('signs nobody in for a role this build does not know', async () => {
    // Sessions fail closed on an unknown role everywhere else; minting one here
    // would be the one place that does not.
    const { deps } = await setUp({}, { user: { role: 'supervisor' } });

    const result = await makeResetPassword(deps)(REQUEST);

    expect(result).toEqual({ ok: true, value: null });
  });
});

describe('a link that does not work', () => {
  it('says the same thing for a token nobody issued', async () => {
    const { deps } = await setUp();

    const result = await makeResetPassword(deps)({ ...REQUEST, token: 'invented' });

    expect(result).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('says the same thing for an expired one', async () => {
    const { deps, users } = await setUp({ expiresAt: NOW - 1 });

    const result = await makeResetPassword(deps)(REQUEST);

    // Expired, already spent and never issued are one fact — this link does
    // not work — and separating them tells whoever holds a stale token
    // whether it was ever real.
    expect(result).toEqual({ ok: false, error: 'invalid_token' });
    expect(users.rows[0]?.passwordHash).toBe(COMPANY_USER.passwordHash);
  });

  it('says the same thing for one already spent', async () => {
    const { deps } = await setUp({ usedAt: NOW - 10 });

    const result = await makeResetPassword(deps)(REQUEST);

    expect(result).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('leaves the sessions standing when nothing was reset', async () => {
    const { deps, sessions } = await setUp({ usedAt: NOW - 10 });

    await makeResetPassword(deps)(REQUEST);

    expect(sessions.records.size).toBe(2);
  });

  it('reports a vanished user as a dead link rather than a crash', async () => {
    const { deps } = await setUp();
    const empty = makeFakeUsers([]);

    const result = await makeResetPassword({ ...deps, users: empty.users })(REQUEST);

    expect(result).toEqual({ ok: false, error: 'invalid_token' });
  });
});

describe('a password the rules refuse', () => {
  it('is rejected before the link is spent', async () => {
    const { deps, resets, tokenHash } = await setUp();

    const result = await makeResetPassword(deps)({ ...REQUEST, newPassword: 'corta' });

    // Burning the one use the link had would send the person back to their
    // inbox to ask for another.
    expect(result).toEqual({ ok: false, error: 'weak_password' });
    expect(resets.rows.get(tokenHash)?.usedAt).toBeNull();
  });

  it('refuses seven characters and accepts eight', async () => {
    const seven = await setUp();
    const eight = await setUp();

    const short = await makeResetPassword(seven.deps)({ ...REQUEST, newPassword: 'siete12' });
    const enough = await makeResetPassword(eight.deps)({ ...REQUEST, newPassword: 'ocho1234' });

    expect(short).toEqual({ ok: false, error: 'weak_password' });
    expect(enough.ok).toBe(true);
  });

  it('touches nothing at all', async () => {
    const { deps, users, sessions } = await setUp();

    await makeResetPassword(deps)({ ...REQUEST, newPassword: '' });

    expect(users.rows[0]?.passwordHash).toBe(COMPANY_USER.passwordHash);
    expect(sessions.records.size).toBe(2);
  });
});
