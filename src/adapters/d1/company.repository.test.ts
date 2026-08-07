import { describe, expect, it } from 'vitest';

import { epochToIso } from '../../shared/clock.ts';
import { D1CompanyRepository, toCompany, toCompanyWithCounts } from './company.repository.ts';
import { makeFakeD1, uniqueViolation } from './d1.fake.ts';

// `created_at` is ISO-8601 UTC text since migration 0004; the repo maps it back
// to epoch seconds, and the `activeSince` floor is bound as ISO for the same
// reason (it compares against an ISO column).
function row(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'la-espiga',
    name: 'Panadería La Espiga',
    rif: 'J-401234567',
    industry: 'panaderia',
    status: 'active',
    created_at: epochToIso(1_760_000_000),
    ...overrides,
  };
}

describe('toCompany', () => {
  it('maps a row, keeping the slug as the id', () => {
    expect(toCompany(row())).toEqual({
      id: 'la-espiga',
      name: 'Panadería La Espiga',
      rif: 'J-401234567',
      industry: 'panaderia',
      status: 'active',
      createdAt: 1_760_000_000,
    });
  });

  it('keeps a missing industry null', () => {
    expect(toCompany(row({ industry: null })).industry).toBeNull();
  });

  it('fails an unreadable status closed', () => {
    expect(toCompany(row({ status: 'trial' })).status).toBe('suspended');
    expect(toCompany(row({ status: 'suspended' })).status).toBe('suspended');
  });

  it('carries the admin table counts', () => {
    const listed = toCompanyWithCounts(row({ cashier_count: 4, recent_validation_count: 1_207 }));
    expect(listed.cashierCount).toBe(4);
    expect(listed.recentValidationCount).toBe(1_207);
  });
});

describe('create', () => {
  it('reads a duplicate RIF apart from a duplicate slug', async () => {
    const rifTaken = makeFakeD1();
    rifTaken.reply({ throws: uniqueViolation('companies.rif') });
    const slugTaken = makeFakeD1();
    slugTaken.reply({ throws: uniqueViolation('companies.id') });

    const input = {
      id: 'la-espiga',
      name: 'Panadería La Espiga',
      rif: 'J-401234567',
      industry: null,
      createdAt: 1_760_000_000,
    };

    expect(await new D1CompanyRepository(rifTaken.db).create(input)).toEqual({
      ok: false,
      error: 'rif_taken',
    });
    expect(await new D1CompanyRepository(slugTaken.db).create(input)).toEqual({
      ok: false,
      error: 'slug_taken',
    });
  });
});

describe('list', () => {
  it('counts only active cashiers and only real validations since the floor', async () => {
    const fake = makeFakeD1();
    fake.reply(
      { rows: [row({ cashier_count: 3, recent_validation_count: 42 })] },
      { rows: [{ total: 1 }] },
    );

    const page = await new D1CompanyRepository(fake.db).list({ activeSince: 1_767_408_000 });

    const sql = fake.calls[0]?.sql ?? '';
    expect(sql).toContain("u.role = 'cashier'");
    expect(sql).toContain("u.status = 'active'");
    expect(sql).toContain('v.is_sandbox = 0');
    expect(fake.calls[0]?.args).toEqual([epochToIso(1_767_408_000), 20, 0]);
    expect(page.items[0]?.recentValidationCount).toBe(42);
    expect(page.total).toBe(1);
  });

  it('searches the name and the RIF with the same pattern', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] }, { rows: [{ total: 0 }] });

    await new D1CompanyRepository(fake.db).list({ activeSince: 0, search: ' espiga ' });

    expect(fake.calls[0]?.args).toEqual([epochToIso(0), '%espiga%', '%espiga%', 20, 0]);
  });

  it('treats % and _ in a merchant name as literal characters', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] }, { rows: [{ total: 0 }] });

    await new D1CompanyRepository(fake.db).list({ activeSince: 0, search: '100%_off' });

    expect(fake.calls[0]?.args[1]).toBe('%100\\%\\_off%');
    expect(fake.calls[0]?.sql).toContain("ESCAPE '\\'");
  });

  it('drops the WHERE clause entirely when nothing is filtered', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] }, { rows: [{ total: 0 }] });

    await new D1CompanyRepository(fake.db).list({ activeSince: 0, search: '   ' });

    // Asserted on the count query: the page query always contains a WHERE,
    // inside the two count subqueries.
    expect(fake.calls[1]?.sql).not.toContain('WHERE');
    expect(fake.calls[1]?.args).toEqual([]);
  });

  it('binds the status filter and clamps the page size', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] }, { rows: [{ total: 0 }] });

    await new D1CompanyRepository(fake.db).list({
      activeSince: 0,
      status: 'suspended',
      limit: 900,
      offset: -5,
    });

    expect(fake.calls[0]?.args).toEqual([epochToIso(0), 'suspended', 100, 0]);
  });
});

describe('update', () => {
  it('never puts the id in the SET clause', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row({ name: 'La Espiga' })] });

    await new D1CompanyRepository(fake.db).update('la-espiga', {
      name: 'La Espiga',
      status: 'suspended',
    });

    const sql = fake.calls[0]?.sql ?? '';
    expect(sql).toContain('SET name = ?, status = ?');
    expect(sql).not.toContain('SET id');
    expect(fake.calls[0]?.args).toEqual(['La Espiga', 'suspended', 'la-espiga']);
  });

  it('can clear the industry, which is distinct from not touching it', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row({ industry: null })] });

    await new D1CompanyRepository(fake.db).update('la-espiga', { industry: null });

    expect(fake.calls[0]?.args).toEqual([null, 'la-espiga']);
  });

  it('reads the row back instead of writing when the patch is empty', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [row()] });

    const result = await new D1CompanyRepository(fake.db).update('la-espiga', {});

    expect(fake.calls[0]?.sql).toContain('SELECT');
    expect(result.ok && result.value.id).toBe('la-espiga');
  });

  it('reports not_found when the update matched no row', async () => {
    const fake = makeFakeD1();
    fake.reply({ rows: [] });

    expect(await new D1CompanyRepository(fake.db).update('ghost', { name: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
