import { describe, expect, it } from 'vitest';

import { epochToIso } from '../../shared/clock.ts';
import { makeFakeD1, uniqueViolation } from './d1.fake.ts';
import { D1UserRepository, toUser, toUserWithSecret } from './user.repository.ts';

// Timestamp columns hold ISO-8601 UTC text since migration 0004; the repo maps
// them back to the epoch seconds the domain asserts on.
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'user-1',
    company_id: 'la-espiga',
    role: 'cashier',
    name: 'María R.',
    email: null,
    username: 'maria.r',
    password_hash: 'pbkdf2$210000$c2FsdA==$aGFzaA==',
    status: 'active',
    last_login_at: epochToIso(1_770_000_000),
    created_at: epochToIso(1_760_000_000),
    ...overrides,
  };
}

const NEW_USER = {
  id: 'user-1',
  companyId: 'la-espiga',
  role: 'cashier',
  name: 'María R.',
  email: null,
  username: 'maria.r',
  passwordHash: 'pbkdf2$210000$c2FsdA==$aGFzaA==',
  createdAt: 1_760_000_000,
} as const;

describe('toUser', () => {
  it('maps a cashier row', () => {
    expect(toUser(row())).toEqual({
      id: 'user-1',
      companyId: 'la-espiga',
      role: 'cashier',
      name: 'María R.',
      email: null,
      username: 'maria.r',
      status: 'active',
      lastLoginAt: 1_770_000_000,
      createdAt: 1_760_000_000,
    });
  });

  it('maps a platform admin, who has no company and no username', () => {
    const admin = toUser(
      row({ role: 'admin', company_id: null, username: null, email: 'ops@cuadre.app' }),
    );
    expect(admin.companyId).toBeNull();
    expect(admin.username).toBeNull();
    expect(admin.email).toBe('ops@cuadre.app');
  });

  it('leaves the password hash off the user entirely', () => {
    expect(toUser(row())).not.toHaveProperty('passwordHash');
    expect(toUserWithSecret(row()).passwordHash).toBe('pbkdf2$210000$c2FsdA==$aGFzaA==');
  });

  it('fails an unreadable role to the least privilege, never to admin', () => {
    expect(toUser(row({ role: 'superadmin' })).role).toBe('cashier');
    expect(toUser(row({ role: 'ADMIN' })).role).toBe('cashier');
  });

  it('fails an unreadable status closed', () => {
    expect(toUser(row({ status: 'pending' })).status).toBe('disabled');
  });

  it('keeps a never-logged-in user null rather than zero', () => {
    expect(toUser(row({ last_login_at: null })).lastLoginAt).toBeNull();
  });
});

describe('createUser', () => {
  it('returns the stored user', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row()] });

    const result = await new D1UserRepository(fake.db).createUser(NEW_USER);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.username).toBe('maria.r');
  });

  it('reads ux_users_email as a taken email', async () => {
    const fake = makeFakeD1();
    fake.reply({ throws: uniqueViolation('users.email') });

    const result = await new D1UserRepository(fake.db).createUser(NEW_USER);

    expect(result).toEqual({ ok: false, error: 'email_taken' });
  });

  it('reads ux_users_login as a taken username inside that company', async () => {
    const fake = makeFakeD1();
    fake.reply({ throws: uniqueViolation('users.company_id', 'users.username') });

    const result = await new D1UserRepository(fake.db).createUser(NEW_USER);

    expect(result).toEqual({ ok: false, error: 'username_taken' });
  });

  it('turns a role/credential CHECK into a typed failure, not a raw D1 string', async () => {
    const fake = makeFakeD1();
    fake.reply({ throws: new Error('D1_ERROR: CHECK constraint failed: users') });

    const result = await new D1UserRepository(fake.db).createUser({ ...NEW_USER, email: 'x@y.z' });

    expect(result).toEqual({ ok: false, error: 'invalid_for_role' });
  });

  it('reads a foreign key failure on insert as an unknown company', async () => {
    const fake = makeFakeD1();
    fake.reply({ throws: new Error('D1_ERROR: FOREIGN KEY constraint failed') });

    const result = await new D1UserRepository(fake.db).createUser(NEW_USER);

    expect(result).toEqual({ ok: false, error: 'unknown_company' });
  });

  it('rethrows a failure that is not a constraint at all', async () => {
    const fake = makeFakeD1();
    fake.reply({ throws: new Error('D1_ERROR: connection reset') });

    await expect(new D1UserRepository(fake.db).createUser(NEW_USER)).rejects.toThrow(
      /connection reset/,
    );
  });
});

describe('setStatus', () => {
  // Access is a column and nothing deletes a user row: `validations.cashier_id`
  // names whoever confirmed each payment for as long as the payment exists.
  it('writes the status it was given, both ways', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row({ status: 'disabled' })] });

    const disabled = await new D1UserRepository(fake.db).setStatus('user-1', 'disabled');

    expect(disabled).toEqual({ ok: true, value: expect.objectContaining({ status: 'disabled' }) });
    expect(fake.calls[0]?.sql).toContain('UPDATE users SET status = ?');
    expect(fake.calls[0]?.args).toEqual(['disabled', 'user-1']);
  });

  it('hands access back, which is what makes a wrong click undoable', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row({ status: 'active' })] });

    const active = await new D1UserRepository(fake.db).setStatus('user-1', 'active');

    expect(active).toEqual({ ok: true, value: expect.objectContaining({ status: 'active' }) });
    expect(fake.calls[0]?.args).toEqual(['active', 'user-1']);
  });

  it('reports not_found when the update matched nobody', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    expect(await new D1UserRepository(fake.db).setStatus('ghost', 'disabled')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});

describe('findStanding', () => {
  // The read every authenticated request makes. A user who is gone must come
  // back as `null`, which is what `resolveSession` turns into a signed-out tab.
  it('answers with the user status and the company status in one row', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [{ status: 'active', company_id: 'la-espiga', company_status: 'active' }] });

    const standing = await new D1UserRepository(fake.db).findStanding('user-1');

    expect(standing).toEqual({
      status: 'active',
      companyId: 'la-espiga',
      companyStatus: 'active',
    });
    // One statement, and a LEFT JOIN so a platform admin — who has no company —
    // still resolves.
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.sql).toContain('LEFT JOIN companies');
  });

  it('is null for a user who is no longer there', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    expect(await new D1UserRepository(fake.db).findStanding('ghost')).toBeNull();
  });
});

describe('lookups', () => {
  it('finds a cashier by the tuple typed on the login screen', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row()] });

    const found = await new D1UserRepository(fake.db).findByCompanyAndUsername(
      'la-espiga',
      'maria.r',
    );

    expect(fake.calls[0]?.args).toEqual(['la-espiga', 'maria.r']);
    expect(found?.passwordHash).toBe('pbkdf2$210000$c2FsdA==$aGFzaA==');
  });

  it('matches an email exactly, leaving normalisation to the domain', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    await new D1UserRepository(fake.db).findByEmail('Ops@Cuadre.app');

    expect(fake.calls[0]?.sql).not.toContain('lower(');
    expect(fake.calls[0]?.args).toEqual(['Ops@Cuadre.app']);
  });

  it('rides the (company_id, role) index when a role filter is given', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row(), row({ id: 'user-2' })] });

    const users = await new D1UserRepository(fake.db).listByCompany('la-espiga', 'cashier');

    expect(fake.calls[0]?.args).toEqual(['la-espiga', 'cashier']);
    expect(users).toHaveLength(2);
  });
});

describe('setPasswordHash', () => {
  it('reports not_found when no row changed', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [], changes: 0 });

    expect(await new D1UserRepository(fake.db).setPasswordHash('ghost', 'pbkdf2$1$a$b')).toEqual({
      ok: false,
      error: 'not_found',
    });
  });

  it('succeeds when one row changed', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [], changes: 1 });

    expect(await new D1UserRepository(fake.db).setPasswordHash('user-1', 'pbkdf2$1$a$b')).toEqual({
      ok: true,
      value: undefined,
    });
  });
});
