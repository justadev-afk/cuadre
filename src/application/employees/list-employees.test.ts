import { describe, expect, it } from 'vitest';

import { makeListEmployees } from './list-employees.ts';
import { makeFakeUserStore } from './user-store.fake.ts';

function staff() {
  const users = makeFakeUserStore([
    {
      id: 'ana',
      companyId: 'la-espiga',
      role: 'company',
      name: 'Ana Pérez',
      email: 'ana@espiga.ve',
      username: null,
      lastLoginAt: 1_769_000_000,
    },
    { id: 'maria', companyId: 'la-espiga', name: 'María Rodríguez', username: 'maria.r' },
    {
      id: 'jose',
      companyId: 'la-espiga',
      name: 'José Blanco',
      username: 'jose.b',
      status: 'disabled',
    },
    { id: 'luis', companyId: 'el-molino', name: 'Luis Marín', username: 'luis.m' },
  ]);
  return { users, listEmployees: makeListEmployees({ users }) };
}

describe('listEmployees', () => {
  it('puts the administrators first, then the cashiers, each alphabetically', async () => {
    // A shop has one or two people who run the panel and a till per counter, so
    // sorting by name alone buries the two accounts that can do anything under
    // "Caja 1, Caja 2, Caja 3".
    const { listEmployees } = staff();

    const employees = await listEmployees({ companyId: 'la-espiga' });

    expect(employees.map((employee) => employee.id)).toEqual(['ana', 'jose', 'maria']);
    expect(employees.map((employee) => employee.role)).toEqual(['company', 'cashier', 'cashier']);
  });

  it('returns the company’s people with when each of them last signed in', async () => {
    const { listEmployees } = staff();

    const employees = await listEmployees({ companyId: 'la-espiga' });

    expect(employees).toEqual([
      {
        id: 'ana',
        role: 'company',
        name: 'Ana Pérez',
        email: 'ana@espiga.ve',
        username: null,
        status: 'active',
        lastLoginAt: 1_769_000_000,
        createdAt: 1_760_000_000,
      },
      expect.objectContaining({ id: 'jose', status: 'disabled' }),
      expect.objectContaining({ id: 'maria', role: 'cashier', lastLoginAt: null }),
    ]);
  });

  it('never reaches another company’s row', async () => {
    const { listEmployees } = staff();

    const espiga = await listEmployees({ companyId: 'la-espiga' });
    const molino = await listEmployees({ companyId: 'el-molino' });

    expect(espiga.map((employee) => employee.id)).not.toContain('luis');
    expect(molino.map((employee) => employee.id)).toEqual(['luis']);
  });

  it('keeps a disabled person on the list', async () => {
    const { listEmployees } = staff();

    const employees = await listEmployees({ companyId: 'la-espiga' });

    expect(employees.find((employee) => employee.id === 'jose')?.status).toBe('disabled');
  });

  it('reads a role this build does not know as the least privileged one', async () => {
    const users = makeFakeUserStore([
      { id: 'old', companyId: 'la-espiga', role: 'supervisor', name: 'Zoraida', username: 'zora' },
    ]);

    const [employee] = await makeListEmployees({ users })({ companyId: 'la-espiga' });

    // `supervisor` was dropped in migration 0002. A row still carrying it must
    // not render as the company's administrator.
    expect(employee?.role).toBe('cashier');
  });
});
