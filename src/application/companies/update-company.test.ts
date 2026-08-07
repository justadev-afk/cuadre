import { describe, expect, it } from 'vitest';

import { makeFakeCompanyStore } from './company-store.fake.ts';
import { makeUpdateCompany, type UpdateCompanyInput } from './update-company.ts';

function editing() {
  const companies = makeFakeCompanyStore([{ id: 'la-espiga' }]);
  return { companies, updateCompany: makeUpdateCompany({ companies }) };
}

describe('updateCompany', () => {
  it('renames a company without touching anything else', async () => {
    const { companies, updateCompany } = editing();

    const updated = await updateCompany({ companyId: 'la-espiga', name: '  La Espiga C.A.  ' });

    expect(updated).toEqual({
      ok: true,
      value: expect.objectContaining({ id: 'la-espiga', name: 'La Espiga C.A.' }),
    });
    expect(companies.patches).toEqual([{ name: 'La Espiga C.A.' }]);
  });

  it('never sends the slug or the RIF to the UPDATE, whatever the form posted', async () => {
    const { companies, updateCompany } = editing();

    // The admin form posts the whole company back, id and RIF included. The
    // patch is built key by key from the three fields that may move, so the
    // two that may not never reach a SET clause — which is what keeps every
    // foreign key in the schema pointing where it did.
    const posted = {
      companyId: 'la-espiga',
      name: 'La Espiga',
      id: 'otra-empresa',
      rif: 'J-00002961-0',
    } satisfies UpdateCompanyInput & Record<string, unknown>;

    await updateCompany(posted);

    expect(companies.patches).toEqual([{ name: 'La Espiga' }]);
    expect(companies.rows[0]?.id).toBe('la-espiga');
    expect(companies.rows[0]?.rif).toBe('J-07013380-5');
  });

  it('suspends and reinstates through status alone', async () => {
    const { updateCompany } = editing();

    const suspended = await updateCompany({ companyId: 'la-espiga', status: 'suspended' });
    expect(suspended).toEqual({
      ok: true,
      value: expect.objectContaining({ status: 'suspended' }),
    });

    const active = await updateCompany({ companyId: 'la-espiga', status: 'active' });
    expect(active).toEqual({ ok: true, value: expect.objectContaining({ status: 'active' }) });
  });

  it('reads an industry cleared on the form as no industry', async () => {
    const { companies, updateCompany } = editing();

    await updateCompany({ companyId: 'la-espiga', industry: '   ' });

    expect(companies.patches).toEqual([{ industry: null }]);
    expect(companies.rows[0]?.industry).toBeNull();
  });

  it('leaves a field the caller did not send out of the patch entirely', async () => {
    const { companies, updateCompany } = editing();

    await updateCompany({ companyId: 'la-espiga' });

    expect(companies.patches).toEqual([{}]);
    expect(companies.rows[0]?.industry).toBe('panaderia');
  });

  it('answers not_found for a slug nobody registered', async () => {
    const { updateCompany } = editing();

    expect(await updateCompany({ companyId: 'la-esquina', name: 'x' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
