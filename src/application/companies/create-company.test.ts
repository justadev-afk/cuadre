import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { verifyPassword } from '../../shared/crypto.ts';
import { fakeIdGen } from '../../shared/id.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { type FakeCompanyRow, makeFakeCompanyStore } from './company-store.fake.ts';
import { type CreateCompanyInput, makeCreateCompany } from './create-company.ts';

const NOW = 1_770_000_000;

/**
 * Only the two calls this flow makes. A `users` table this small is honest
 * about what the use case is allowed to reach for.
 */
type AdminRow = {
  id: string;
  companyId: string;
  role: string;
  name: string;
  email: string | null;
  username: string | null;
  passwordHash: string;
  createdAt: number;
};

function makeFakeAdmins(seed: readonly AdminRow[] = []) {
  const rows = [...seed];
  return {
    rows,
    async findByEmail(email: string) {
      return rows.find((row) => row.email === email) ?? null;
    },
    async createUser(input: AdminRow): Promise<Result<{ id: string }, 'email_taken'>> {
      if (rows.some((row) => row.email === input.email)) return err('email_taken');
      rows.push(input);
      return ok({ id: input.id });
    },
  };
}

function registering(seed: readonly Partial<FakeCompanyRow>[] = []) {
  const companies = makeFakeCompanyStore(seed);
  const users = makeFakeAdmins();
  return {
    companies,
    users,
    createCompany: makeCreateCompany({
      companies,
      users,
      clock: fixedClock(NOW),
      idGen: fakeIdGen({ uuids: ['admin-uuid'] }),
    }),
  };
}

const INPUT: CreateCompanyInput = {
  slug: 'la-espiga',
  name: '  Panadería La Espiga  ',
  rif: 'J-07013380-5',
  industry: 'panaderia',
  admin: { name: 'Ana Pérez', email: 'Ana@Espiga.ve ', password: 'contraseña-larga' },
};

describe('createCompany', () => {
  it('creates the company and its first company user in one flow', async () => {
    const { companies, users, createCompany } = registering();

    const created = await createCompany(INPUT);

    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.company).toEqual({
      id: 'la-espiga',
      name: 'Panadería La Espiga',
      rif: 'J-07013380-5',
      industry: 'panaderia',
      status: 'active',
      createdAt: NOW,
    });
    expect(companies.rows).toHaveLength(1);
    expect(users.rows[0]).toEqual(
      expect.objectContaining({
        id: 'admin-uuid',
        companyId: 'la-espiga',
        // The merchant's own administrator. The only other role their staff
        // has is `cashier`, and a cashier is created from the company's own
        // panel with a username and a PIN.
        role: 'company',
        name: 'Ana Pérez',
        // Lower-cased and trimmed: `findByEmail` matches the stored value
        // exactly, so the login lookup keeps riding its unique index.
        email: 'ana@espiga.ve',
        username: null,
        createdAt: NOW,
      }),
    );
  });

  it('stores the administrator’s password hashed, never the password', async () => {
    const { users, createCompany } = registering();

    await createCompany(INPUT);

    const stored = users.rows[0]?.passwordHash ?? '';
    expect(stored).not.toContain('contraseña-larga');
    expect(await verifyPassword('contraseña-larga', stored)).toBe(true);
  });

  it('folds the slug to its canonical form, because it is about to be a primary key', async () => {
    const { createCompany } = registering();

    const created = await createCompany({ ...INPUT, slug: 'Panadería La Espiga, C.A.' });

    expect(created).toEqual({
      ok: true,
      value: expect.objectContaining({
        company: expect.objectContaining({ id: 'panaderia-la-espiga-c-a' }),
      }),
    });
  });

  it('canonicalises the RIF and refuses one whose check digit does not add up', async () => {
    const { companies, createCompany } = registering();

    const spaced = await createCompany({ ...INPUT, rif: 'j07013380 5' });
    expect(spaced).toEqual({
      ok: true,
      value: expect.objectContaining({
        company: expect.objectContaining({ rif: 'J-07013380-5' }),
      }),
    });

    // One digit off. The RIF is UNIQUE, so a typo that passed would squat on
    // somebody else's tax id permanently.
    const mistyped = await createCompany({
      ...INPUT,
      slug: 'otra',
      rif: 'J-07013380-4',
    });
    expect(mistyped).toEqual({ ok: false, error: 'invalid_rif' });
    expect(companies.rows).toHaveLength(1);
  });

  it('refuses a slug that cannot be one, and writes nothing', async () => {
    const { companies, users, createCompany } = registering();

    expect(await createCompany({ ...INPUT, slug: '  ??  ' })).toEqual({
      ok: false,
      error: 'invalid_slug',
    });
    expect(companies.rows).toHaveLength(0);
    expect(users.rows).toHaveLength(0);
  });

  it('refuses a password the domain calls too short, before any row exists', async () => {
    const { companies, createCompany } = registering();

    const weak = await createCompany({ ...INPUT, admin: { ...INPUT.admin, password: 'corta' } });

    expect(weak).toEqual({ ok: false, error: 'weak_password' });
    expect(companies.rows).toHaveLength(0);
  });

  it('tells a taken slug apart from a taken RIF', async () => {
    const { createCompany } = registering([
      { id: 'la-espiga', rif: 'J-00002961-0' },
      { id: 'el-molino', rif: 'J-07013380-5' },
    ]);

    expect(await createCompany(INPUT)).toEqual({ ok: false, error: 'slug_taken' });
    expect(await createCompany({ ...INPUT, slug: 'otra-panaderia' })).toEqual({
      ok: false,
      error: 'rif_taken',
    });
  });

  it('refuses a registered email before it creates a company nobody could administer', async () => {
    const { companies, users, createCompany } = registering();
    users.rows.push({
      id: 'someone',
      companyId: 'el-molino',
      role: 'company',
      name: 'Ana Pérez',
      email: 'ana@espiga.ve',
      username: null,
      passwordHash: 'x',
      createdAt: 0,
    });

    expect(await createCompany(INPUT)).toEqual({ ok: false, error: 'email_taken' });
    // The point of checking first: the slug and the RIF are both UNIQUE, so a
    // company created here would have spent them on a merchant with no way in.
    expect(companies.rows).toHaveLength(0);
  });

  it('still answers email_taken when the address is claimed after the check', async () => {
    const companies = makeFakeCompanyStore();
    const createCompany = makeCreateCompany({
      companies,
      // The race the pre-check cannot close: the index is what decides, and it
      // decided between the two calls.
      users: {
        async findByEmail() {
          return null;
        },
        async createUser() {
          return err('email_taken');
        },
      },
      clock: fixedClock(NOW),
      idGen: fakeIdGen({ uuids: ['admin-uuid'] }),
    });

    expect(await createCompany(INPUT)).toEqual({ ok: false, error: 'email_taken' });
    // The refusal is still a value the admin can act on, not a 500 — and the
    // company left standing with nobody able to sign into it is what the
    // `company_created_without_admin` line on this path is for.
    expect(companies.rows).toHaveLength(1);
  });
});
