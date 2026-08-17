import { describe, expect, it } from 'vitest';

import { verifyPassword } from '../../shared/crypto.ts';
import { makeUpdateEmployee } from './update-employee.ts';
import { type FakeUserRow, makeFakeSessions, makeFakeUserStore } from './user-store.fake.ts';

/**
 * Who is making the change. Only one rule reads it — nobody may change their
 * own access — so every call below is somebody editing *somebody else*, and the
 * one that is not has its own test at the bottom.
 */
const ACTOR = 'the-administrator';

const STAFF: readonly Partial<FakeUserRow>[] = [
  {
    id: 'ana',
    companyId: 'la-espiga',
    role: 'company',
    name: 'Ana Pérez',
    email: 'ana@espiga.ve',
    username: null,
  },
  { id: 'maria', companyId: 'la-espiga', name: 'María Rodríguez', username: 'maria.r' },
  { id: 'luis', companyId: 'el-molino', name: 'Luis Marín', username: 'luis.m' },
];

function editing(seed: readonly Partial<FakeUserRow>[] = STAFF) {
  const users = makeFakeUserStore(seed);
  const sessions = makeFakeSessions(2);
  return {
    users,
    sessions,
    updateEmployee: makeUpdateEmployee({ users, sessions: sessions.store }),
  };
}

describe('updateEmployee', () => {
  it('renames somebody', async () => {
    const { users, updateEmployee } = editing();

    const updated = await updateEmployee({
      companyId: 'la-espiga',
      userId: 'maria',
      actorUserId: ACTOR,
      name: ' María R. Rodríguez ',
    });

    expect(updated).toEqual({
      ok: true,
      value: expect.objectContaining({ id: 'maria', name: 'María R. Rodríguez' }),
    });
    expect(users.rows.find((row) => row.id === 'maria')?.name).toBe('María R. Rodríguez');
  });

  it('resets a cashier’s PIN — the only reset channel they have', async () => {
    const { users, sessions, updateEmployee } = editing();

    const updated = await updateEmployee({
      companyId: 'la-espiga',
      userId: 'maria',
      actorUserId: ACTOR,
      pin: '8241',
    });

    expect(updated.ok).toBe(true);
    const stored = users.rows.find((row) => row.id === 'maria')?.passwordHash ?? '';
    expect(await verifyPassword('8241', stored)).toBe(true);
    // A session in this product has no expiry of its own, so the old PIN would
    // otherwise survive as a phone left signed in at the counter.
    expect(sessions.revoked).toEqual(['maria']);
  });

  it('refuses a weak PIN without applying the rename that came with it', async () => {
    const { users, sessions, updateEmployee } = editing();

    const refused = await updateEmployee({
      companyId: 'la-espiga',
      userId: 'maria',
      actorUserId: ACTOR,
      name: 'Otro Nombre',
      pin: '1234',
    });

    expect(refused).toEqual({ ok: false, error: 'weak_pin' });
    expect(users.writes).toEqual([]);
    expect(users.rows.find((row) => row.id === 'maria')?.name).toBe('María Rodríguez');
    expect(sessions.revoked).toEqual([]);
  });

  it('refuses to write a PIN onto a company user', async () => {
    const { users, updateEmployee } = editing();

    // Four digits in `password_hash` would be a password `isValidPassword`
    // would have refused, installed through a field naming a credential this
    // person does not use.
    expect(
      await updateEmployee({
        companyId: 'la-espiga',
        userId: 'ana',
        actorUserId: ACTOR,
        pin: '8241',
      }),
    ).toEqual({
      ok: false,
      error: 'not_a_cashier',
    });
    expect(users.writes).toEqual([]);
  });

  it('disables somebody and ends the sessions they already had open', async () => {
    const { users, sessions, updateEmployee } = editing();

    const updated = await updateEmployee({
      companyId: 'la-espiga',
      userId: 'maria',
      actorUserId: ACTOR,
      status: 'disabled',
    });

    expect(updated).toEqual({ ok: true, value: expect.objectContaining({ status: 'disabled' }) });
    expect(users.rows.find((row) => row.id === 'maria')?.status).toBe('disabled');
    // Disabling stops the next sign-in. The tab already open at the till is
    // the one that matters.
    expect(sessions.revoked).toEqual(['maria']);
  });

  it('refuses to disable the last administrator a company has left', async () => {
    const { users, sessions, updateEmployee } = editing();

    const refused = await updateEmployee({
      companyId: 'la-espiga',
      userId: 'ana',
      actorUserId: ACTOR,
      status: 'disabled',
    });

    expect(refused).toEqual({ ok: false, error: 'last_administrator' });
    expect(users.writes).toEqual([]);
    expect(sessions.revoked).toEqual([]);
  });

  it('allows it once a second administrator can still sign in', async () => {
    const { updateEmployee } = editing([
      ...STAFF,
      {
        id: 'bea',
        companyId: 'la-espiga',
        role: 'company',
        name: 'Beatriz Silva',
        email: 'bea@espiga.ve',
        username: null,
      },
    ]);

    expect(
      await updateEmployee({
        companyId: 'la-espiga',
        userId: 'ana',
        actorUserId: ACTOR,
        status: 'disabled',
      }),
    ).toEqual({ ok: true, value: expect.objectContaining({ status: 'disabled' }) });
  });

  it('does not count a disabled administrator as the way back in', async () => {
    const { updateEmployee } = editing([
      ...STAFF,
      {
        id: 'bea',
        companyId: 'la-espiga',
        role: 'company',
        name: 'Beatriz Silva',
        email: 'bea@espiga.ve',
        username: null,
        status: 'disabled',
      },
    ]);

    expect(
      await updateEmployee({
        companyId: 'la-espiga',
        userId: 'ana',
        actorUserId: ACTOR,
        status: 'disabled',
      }),
    ).toEqual({ ok: false, error: 'last_administrator' });
  });

  it('never reaches another company’s row, even with the right uuid', async () => {
    const { users, sessions, updateEmployee } = editing();

    // `updateProfile`, `setPasswordHash` and `disable` are keyed by the uuid
    // alone — there is no `company_id` in their WHERE — so this read is the
    // whole boundary between two merchants.
    const refused = await updateEmployee({
      companyId: 'la-espiga',
      userId: 'luis',
      actorUserId: ACTOR,
      name: 'Robado',
      pin: '8241',
    });

    expect(refused).toEqual({ ok: false, error: 'not_found' });
    expect(users.writes).toEqual([]);
    expect(users.rows.find((row) => row.id === 'luis')?.name).toBe('Luis Marín');
    expect(sessions.revoked).toEqual([]);
  });

  it('answers a uuid nobody has the same way as one belonging to somebody else', async () => {
    const { updateEmployee } = editing();

    expect(
      await updateEmployee({
        companyId: 'la-espiga',
        userId: 'nadie',
        actorUserId: ACTOR,
        name: 'x',
      }),
    ).toEqual({ ok: false, error: 'not_found' });
  });
});

/**
 * A merchant who disables themselves is locked out of their own panel, and the
 * last-administrator count does not catch it: a shop with two owners would let
 * one of them switch their own access off quite happily.
 */
describe('your own access', () => {
  it('refuses to disable the person making the change, and writes nothing', async () => {
    const { users, updateEmployee } = editing();

    const refused = await updateEmployee({
      companyId: 'la-espiga',
      userId: 'ana',
      actorUserId: 'ana',
      status: 'disabled',
    });

    expect(refused).toEqual({ ok: false, error: 'own_access' });
    expect(users.rows.find((row) => row.id === 'ana')?.status).toBe('active');
    expect(users.writes).toEqual([]);
  });

  it('refuses to re-enable yourself too — the id is the rule, not the direction', async () => {
    // Unreachable through the app (a disabled user's session is revoked on its
    // next request), which is exactly why it must not depend on the direction.
    const { updateEmployee } = editing([
      ...STAFF.filter((row) => row.id !== 'ana'),
      {
        id: 'ana',
        companyId: 'la-espiga',
        role: 'company',
        name: 'Ana Pérez',
        email: 'ana@espiga.ve',
        username: null,
        status: 'disabled',
      },
    ]);

    expect(
      await updateEmployee({
        companyId: 'la-espiga',
        userId: 'ana',
        actorUserId: 'ana',
        status: 'active',
      }),
    ).toEqual({ ok: false, error: 'own_access' });
  });

  it('still lets you rename yourself — a name is not a permission', async () => {
    const { users, updateEmployee } = editing();

    const renamed = await updateEmployee({
      companyId: 'la-espiga',
      userId: 'ana',
      actorUserId: 'ana',
      name: 'Ana P. Pérez',
    });

    expect(renamed).toMatchObject({ ok: true });
    expect(users.rows.find((row) => row.id === 'ana')?.name).toBe('Ana P. Pérez');
  });
});
