import { describe, expect, it } from 'vitest';

import { verifyPassword } from '../../shared/crypto.ts';
import { makeUpdateEmployee } from './update-employee.ts';
import { type FakeUserRow, makeFakeSessions, makeFakeUserStore } from './user-store.fake.ts';

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
    expect(await updateEmployee({ companyId: 'la-espiga', userId: 'ana', pin: '8241' })).toEqual({
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
      await updateEmployee({ companyId: 'la-espiga', userId: 'ana', status: 'disabled' }),
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
      await updateEmployee({ companyId: 'la-espiga', userId: 'ana', status: 'disabled' }),
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

    expect(await updateEmployee({ companyId: 'la-espiga', userId: 'nadie', name: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
