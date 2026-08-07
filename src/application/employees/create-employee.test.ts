import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { verifyPassword } from '../../shared/crypto.ts';
import { fakeIdGen } from '../../shared/id.ts';
import { type CreateEmployeeInput, makeCreateEmployee } from './create-employee.ts';
import { type FakeUserRow, makeFakeUserStore } from './user-store.fake.ts';

const NOW = 1_770_000_000;

function hiring(seed: readonly Partial<FakeUserRow>[] = []) {
  const users = makeFakeUserStore(seed);
  return {
    users,
    createEmployee: makeCreateEmployee({
      users,
      clock: fixedClock(NOW),
      idGen: fakeIdGen({ uuids: ['cashier-uuid'] }),
    }),
  };
}

const INPUT: CreateEmployeeInput = {
  companyId: 'la-espiga',
  name: '  María Rodríguez ',
  username: ' maria.r ',
  pin: '8241',
};

describe('createEmployee', () => {
  it('creates a cashier with a username and no email at all', async () => {
    const { users, createEmployee } = hiring();

    const created = await createEmployee(INPUT);

    expect(created).toEqual({
      ok: true,
      value: {
        id: 'cashier-uuid',
        role: 'cashier',
        name: 'María Rodríguez',
        // A cashier's PIN is reset by their own company, so they need no mail
        // channel and we carry no address for them.
        email: null,
        username: 'maria.r',
        status: 'active',
        lastLoginAt: null,
        createdAt: NOW,
      },
    });
    expect(users.rows[0]?.companyId).toBe('la-espiga');
  });

  it('stores the PIN hashed, never the PIN', async () => {
    const { users, createEmployee } = hiring();

    await createEmployee(INPUT);

    const stored = users.rows[0]?.passwordHash ?? '';
    expect(stored).not.toContain('8241');
    expect(await verifyPassword('8241', stored)).toBe(true);
  });

  it('refuses a username the domain will not fold, and writes nothing', async () => {
    const { users, createEmployee } = hiring();

    // 'maria.r' and 'Maria.R' resolving to two rows in one company is a
    // cashier signing into somebody else's history, so upper case is refused
    // rather than lower-cased.
    expect(await createEmployee({ ...INPUT, username: 'Maria.R' })).toEqual({
      ok: false,
      error: 'invalid_username',
    });
    expect(users.writes).toEqual([]);
  });

  it('refuses a PIN an attacker would try first', async () => {
    const { users, createEmployee } = hiring();

    for (const pin of ['1234', '0000', '4321', '12']) {
      expect(await createEmployee({ ...INPUT, pin })).toEqual({ ok: false, error: 'weak_pin' });
    }
    expect(users.writes).toEqual([]);
  });

  it('reports a username already in use in this company', async () => {
    const { createEmployee } = hiring([
      { id: 'other', companyId: 'la-espiga', username: 'maria.r' },
    ]);

    expect(await createEmployee(INPUT)).toEqual({ ok: false, error: 'username_taken' });
  });

  it('lets two companies each have a maria.r', async () => {
    const { createEmployee } = hiring([
      { id: 'other', companyId: 'el-molino', username: 'maria.r' },
    ]);

    // The login tuple is `(company_id, username)` — literally what is typed on
    // the login screen — so the name is only taken inside one merchant.
    expect(await createEmployee(INPUT)).toEqual({ ok: true, value: expect.anything() });
  });
});
