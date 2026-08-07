import { describe, expect, it } from 'vitest';

import { makeDeleteEmployee } from './delete-employee.ts';
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
  { id: 'jose', companyId: 'la-espiga', name: 'José Blanco', username: 'jose.b' },
  { id: 'luis', companyId: 'el-molino', name: 'Luis Marín', username: 'luis.m' },
];

function firing(seed: readonly Partial<FakeUserRow>[] = STAFF) {
  const users = makeFakeUserStore(seed);
  const sessions = makeFakeSessions();
  return {
    users,
    sessions,
    deleteEmployee: makeDeleteEmployee({ users, sessions: sessions.store }),
  };
}

describe('deleteEmployee', () => {
  it('deletes a cashier who never confirmed anything', async () => {
    const { users, sessions, deleteEmployee } = firing();

    const deleted = await deleteEmployee({ companyId: 'la-espiga', userId: 'jose' });

    expect(deleted).toEqual({ ok: true, value: { outcome: 'deleted' } });
    expect(users.rows.map((row) => row.id)).toEqual(['ana', 'maria', 'luis']);
    expect(sessions.revoked).toEqual(['jose']);
  });

  it('keeps the validations of a cashier who confirmed payments, and disables them', async () => {
    const { users, sessions, deleteEmployee } = firing();
    // `validations.cashier_id` points at her with no ON DELETE clause, so
    // SQLite refuses the delete. The repository must not cascade: a validated
    // payment is an accounting fact and it keeps naming who took the money.
    users.withHistory.add('maria');

    const deleted = await deleteEmployee({ companyId: 'la-espiga', userId: 'maria' });

    expect(deleted).toEqual({ ok: true, value: { outcome: 'disabled' } });
    expect(users.rows.find((row) => row.id === 'maria')?.status).toBe('disabled');
    expect(sessions.revoked).toEqual(['maria']);
  });

  it('revokes the sessions before it touches the row', async () => {
    const order: string[] = [];
    const users = makeFakeUserStore(STAFF);
    const deleteEmployee = makeDeleteEmployee({
      users: {
        ...users,
        async remove(id) {
          order.push('remove');
          return users.remove(id);
        },
      },
      sessions: {
        async deleteAllForUser(userId) {
          order.push(`revoke:${userId}`);
          return 1;
        },
      },
    });

    await deleteEmployee({ companyId: 'la-espiga', userId: 'jose' });

    // A write that lands and a revocation that fails leaves somebody deleted
    // holding a live till; the other order only leaves a retry.
    expect(order).toEqual(['revoke:jose', 'remove']);
  });

  it('never reaches another company’s row, even with the right uuid', async () => {
    const { users, sessions, deleteEmployee } = firing();

    const refused = await deleteEmployee({ companyId: 'la-espiga', userId: 'luis' });

    expect(refused).toEqual({ ok: false, error: 'not_found' });
    expect(users.writes).toEqual([]);
    expect(users.rows.map((row) => row.id)).toContain('luis');
    expect(sessions.revoked).toEqual([]);
  });

  it('refuses to remove the last administrator a company has left', async () => {
    const { users, sessions, deleteEmployee } = firing();

    const refused = await deleteEmployee({ companyId: 'la-espiga', userId: 'ana' });

    expect(refused).toEqual({ ok: false, error: 'last_administrator' });
    expect(users.writes).toEqual([]);
    expect(sessions.revoked).toEqual([]);
  });

  it('answers not_found for a uuid nobody has', async () => {
    const { deleteEmployee } = firing();

    expect(await deleteEmployee({ companyId: 'la-espiga', userId: 'nadie' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
