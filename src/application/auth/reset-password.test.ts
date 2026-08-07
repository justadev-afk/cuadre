import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { sha256Hex } from '../../shared/crypto.ts';
import type { StoredSession } from '../session.ts';
import {
  COMPANY_USER,
  type FakeResetRow,
  fakeHashOf,
  makeFakePasswords,
  makeFakeResets,
  makeFakeSessions,
  makeFakeUsers,
} from './auth.fake.ts';
import { makeResetPassword, type ResetPasswordDeps } from './reset-password.ts';

const NOW = 1_770_000_000;
const TOKEN = 'a3f1c0de';
const NEW_PASSWORD = 'una clave nueva';

const SESSION: StoredSession = {
  userId: COMPANY_USER.id,
  role: 'company',
  companyId: 'la-espiga',
  name: 'Ana P.',
  username: null,
  email: 'ana@laespiga.com',
  createdAt: NOW - 3600,
  shiftAckAt: NOW - 3600,
  ipHash: 'b1946ac92492d2347c6235b4d2611184',
};

async function setUp(overrides: Partial<FakeResetRow> = {}) {
  const tokenHash = await sha256Hex(TOKEN);
  const users = makeFakeUsers([COMPANY_USER]);
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
  const passwords = makeFakePasswords();

  const deps: ResetPasswordDeps = {
    resets: resets.resets,
    users: users.users,
    sessions: sessions.sessions,
    passwords: passwords.passwords,
    clock: fixedClock(NOW),
  };

  return { deps, users, resets, sessions, passwords, tokenHash };
}

describe('spending a good link', () => {
  it('sets the new password', async () => {
    const { deps, users } = await setUp();

    const result = await makeResetPassword(deps)({ token: TOKEN, newPassword: NEW_PASSWORD });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(users.rows[0]?.passwordHash).toBe(fakeHashOf(NEW_PASSWORD));
  });

  it('looks the token up by its SHA-256 and never by itself', async () => {
    const { deps, resets, tokenHash } = await setUp();

    await makeResetPassword(deps)({ token: TOKEN, newPassword: NEW_PASSWORD });

    // The database holds hashes, so a dump of `password_resets` is a list of
    // dead strings rather than a list of live links.
    expect(resets.lookups).toEqual([tokenHash]);
    expect(resets.lookups).not.toContain(TOKEN);
  });

  it('spends the link', async () => {
    const { deps, resets, tokenHash } = await setUp();

    await makeResetPassword(deps)({ token: TOKEN, newPassword: NEW_PASSWORD });

    expect(resets.rows.get(tokenHash)?.usedAt).toBe(NOW);
  });

  it('refuses the second click on the same link', async () => {
    const { deps } = await setUp();
    const reset = makeResetPassword(deps);

    const first = await reset({ token: TOKEN, newPassword: NEW_PASSWORD });
    const second = await reset({ token: TOKEN, newPassword: 'otra clave nueva' });

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('closes every session that user had anywhere', async () => {
    const { deps, sessions } = await setUp();

    await makeResetPassword(deps)({ token: TOKEN, newPassword: NEW_PASSWORD });

    // A password is reset because somebody else might have had the old one.
    // Leaving the tab they were already signed in on alive answers the wrong
    // half of that.
    expect(sessions.records.size).toBe(0);
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

    await makeResetPassword(deps)({ token: TOKEN, newPassword: NEW_PASSWORD });

    expect(resets.rows.get('another-hash')?.usedAt).toBe(NOW);
  });
});

describe('a link that does not work', () => {
  it('says the same thing for a token nobody issued', async () => {
    const { deps } = await setUp();

    const result = await makeResetPassword(deps)({
      token: 'invented',
      newPassword: NEW_PASSWORD,
    });

    expect(result).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('says the same thing for an expired one', async () => {
    const { deps, users } = await setUp({ expiresAt: NOW - 1 });

    const result = await makeResetPassword(deps)({ token: TOKEN, newPassword: NEW_PASSWORD });

    // Expired, already spent and never issued are one fact — this link does
    // not work — and separating them tells whoever holds a stale token
    // whether it was ever real.
    expect(result).toEqual({ ok: false, error: 'invalid_token' });
    expect(users.rows[0]?.passwordHash).toBe(COMPANY_USER.passwordHash);
  });

  it('says the same thing for one already spent', async () => {
    const { deps } = await setUp({ usedAt: NOW - 10 });

    const result = await makeResetPassword(deps)({ token: TOKEN, newPassword: NEW_PASSWORD });

    expect(result).toEqual({ ok: false, error: 'invalid_token' });
  });

  it('leaves the sessions standing when nothing was reset', async () => {
    const { deps, sessions } = await setUp({ usedAt: NOW - 10 });

    await makeResetPassword(deps)({ token: TOKEN, newPassword: NEW_PASSWORD });

    expect(sessions.records.size).toBe(2);
  });

  it('reports a vanished user as a dead link rather than a crash', async () => {
    const { deps } = await setUp();
    const empty = makeFakeUsers([]);

    const result = await makeResetPassword({ ...deps, users: empty.users })({
      token: TOKEN,
      newPassword: NEW_PASSWORD,
    });

    expect(result).toEqual({ ok: false, error: 'invalid_token' });
  });
});

describe('a password the rules refuse', () => {
  it('is rejected before the link is spent', async () => {
    const { deps, resets, tokenHash } = await setUp();

    const result = await makeResetPassword(deps)({ token: TOKEN, newPassword: 'corta' });

    // Burning the one use the link had would send the person back to their
    // inbox to ask for another.
    expect(result).toEqual({ ok: false, error: 'weak_password' });
    expect(resets.rows.get(tokenHash)?.usedAt).toBeNull();
  });

  it('touches nothing at all', async () => {
    const { deps, users, sessions } = await setUp();

    await makeResetPassword(deps)({ token: TOKEN, newPassword: '' });

    expect(users.rows[0]?.passwordHash).toBe(COMPANY_USER.passwordHash);
    expect(sessions.records.size).toBe(2);
  });
});
