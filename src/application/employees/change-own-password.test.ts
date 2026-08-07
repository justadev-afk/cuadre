import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
import { makeChangeOwnPassword } from './change-own-password.ts';
import { type FakeUserRow, makeFakeSessions, makeFakeUserStore } from './user-store.fake.ts';

const CURRENT = 'contraseña-actual';

async function profile(overrides: readonly Partial<FakeUserRow>[] = []) {
  const passwordHash = await hashPassword(CURRENT);
  const users = makeFakeUserStore([
    {
      id: 'ana',
      companyId: 'la-espiga',
      role: 'company',
      name: 'Ana Pérez',
      email: 'ana@espiga.ve',
      username: null,
      passwordHash,
    },
    {
      id: 'luis',
      companyId: 'el-molino',
      role: 'company',
      name: 'Luis Marín',
      email: 'luis@molino.ve',
      username: null,
      passwordHash,
    },
    ...overrides,
  ]);
  const sessions = makeFakeSessions(3);
  return {
    users,
    sessions,
    changeOwnPassword: makeChangeOwnPassword({ users, sessions: sessions.store }),
  };
}

const INPUT = {
  companyId: 'la-espiga',
  userId: 'ana',
  currentPassword: CURRENT,
  newPassword: 'una-contraseña-nueva',
};

describe('changeOwnPassword', () => {
  it('replaces the hash and signs every device out, its own included', async () => {
    const { users, sessions, changeOwnPassword } = await profile();

    const changed = await changeOwnPassword(INPUT);

    expect(changed).toEqual({ ok: true, value: { sessionsEnded: 3 } });
    const stored = users.rows.find((row) => row.id === 'ana')?.passwordHash ?? '';
    expect(await verifyPassword('una-contraseña-nueva', stored)).toBe(true);
    expect(await verifyPassword(CURRENT, stored)).toBe(false);
    // A session here has no expiry of its own, so one opened with the old
    // password would outlive it indefinitely.
    expect(sessions.revoked).toEqual(['ana']);
  });

  it('refuses a wrong current password and writes nothing', async () => {
    const { users, sessions, changeOwnPassword } = await profile();

    const refused = await changeOwnPassword({ ...INPUT, currentPassword: 'otra-cosa-larga' });

    expect(refused).toEqual({ ok: false, error: 'wrong_password' });
    expect(users.writes).toEqual([]);
    expect(sessions.revoked).toEqual([]);
  });

  it('refuses a new password the domain calls too short', async () => {
    const { users, changeOwnPassword } = await profile();

    expect(await changeOwnPassword({ ...INPUT, newPassword: 'corta' })).toEqual({
      ok: false,
      error: 'weak_password',
    });
    expect(users.writes).toEqual([]);
  });

  it('never reaches another company’s user', async () => {
    const { users, changeOwnPassword } = await profile();

    // Both ids come from the session; checking that they agree costs one
    // comparison and means a route wired to the wrong one cannot cross the
    // boundary between two merchants.
    const refused = await changeOwnPassword({ ...INPUT, userId: 'luis' });

    expect(refused).toEqual({ ok: false, error: 'not_found' });
    expect(users.writes).toEqual([]);
  });

  it('has nothing to offer a cashier', async () => {
    const { changeOwnPassword } = await profile([
      { id: 'maria', companyId: 'la-espiga', username: 'maria.r' },
    ]);

    // No email to look the hash up by, and no password screen: a cashier's PIN
    // is reset by their company. Reaching here at all is a routing fault.
    await expect(changeOwnPassword({ ...INPUT, userId: 'maria' })).rejects.toBeInstanceOf(AppError);
  });

  it('answers not_found for a uuid nobody has', async () => {
    const { changeOwnPassword } = await profile();

    expect(await changeOwnPassword({ ...INPUT, userId: 'nadie' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
