import { describe, expect, it } from 'vitest';

import { makeFakeBankAccounts, makeFakeCompanyStore } from './company-store.fake.ts';
import { makeGetCompany } from './get-company.ts';

function detail() {
  const companies = makeFakeCompanyStore([
    { id: 'la-espiga' },
    { id: 'el-molino', name: 'Molino del Valle', rif: 'J-00002961-0' },
  ]);
  const bankAccounts = makeFakeBankAccounts([
    { id: 'espiga-banesco', companyId: 'la-espiga', label: 'Caja principal' },
    { id: 'molino-banesco', companyId: 'el-molino', label: null },
  ]);
  return { companies, bankAccounts, getCompany: makeGetCompany({ companies, bankAccounts }) };
}

describe('getCompany', () => {
  it('returns the company with the affiliations the screen renders', async () => {
    const { getCompany } = detail();

    const found = await getCompany({ companyId: 'la-espiga' });

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.company.name).toBe('Panadería La Espiga');
    expect(found.value.bankAccounts).toEqual([
      {
        id: 'espiga-banesco',
        bank: 'banesco',
        environment: 'production',
        status: 'active',
        label: 'Caja principal',
        clientIdLast6: 'a91c2f',
        verifiedAt: 1_760_000_500,
        credsExpireAt: null,
        createdAt: 1_760_000_000,
      },
    ]);
  });

  it('leaves the sealed columns on the row they came from', async () => {
    const { getCompany } = detail();

    const found = await getCompany({ companyId: 'la-espiga' });

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    // The fake's rows carry a `secret`; the mapping is field by field, so a
    // response built from this object cannot serialise what it never copied.
    expect(JSON.stringify(found.value)).not.toContain('sealed-client-secret');
  });

  it('reads one company, and only that company’s banks', async () => {
    const { bankAccounts, getCompany } = detail();

    const found = await getCompany({ companyId: 'el-molino' });

    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.value.company.id).toBe('el-molino');
    expect(found.value.bankAccounts.map((account) => account.id)).toEqual(['molino-banesco']);
    // The scope reached the store, rather than being applied after a wider read.
    expect(bankAccounts.asked).toEqual(['el-molino']);
  });

  it('answers not_found for a slug nobody registered', async () => {
    const { getCompany } = detail();

    expect(await getCompany({ companyId: 'la-esquina' })).toEqual({
      ok: false,
      error: 'not_found',
    });
  });
});
