import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { makeFakeCompanyStore } from './company-store.fake.ts';
import { makeListCompanies, RECENT_ACTIVITY_DAYS } from './list-companies.ts';

const NOW = 1_770_000_000;

function listing(companies = makeFakeCompanyStore()) {
  return { companies, listCompanies: makeListCompanies({ companies, clock: fixedClock(NOW) }) };
}

describe('listCompanies', () => {
  it('turns "the last thirty days" into a boundary the repository can bind', async () => {
    const { companies, listCompanies } = listing();

    await listCompanies({});

    expect(companies.queries[0]).toEqual({
      activeSince: NOW - RECENT_ACTIVITY_DAYS * 24 * 60 * 60,
    });
  });

  it('passes the admin table filters through untouched', async () => {
    const { companies, listCompanies } = listing();

    await listCompanies({ search: 'espiga', status: 'suspended', limit: 50, offset: 100 });

    expect(companies.queries[0]).toEqual({
      search: 'espiga',
      status: 'suspended',
      limit: 50,
      offset: 100,
      activeSince: NOW - RECENT_ACTIVITY_DAYS * 24 * 60 * 60,
    });
  });

  it('carries the counts the table reads, and the total behind the pager', async () => {
    const { listCompanies } = listing(
      makeFakeCompanyStore([
        { id: 'la-espiga', cashierCount: 4, recentValidationCount: 1_207 },
        { id: 'el-molino', rif: 'J-00002961-0', cashierCount: 0, recentValidationCount: 0 },
      ]),
    );

    const page = await listCompanies({});

    expect(page.total).toBe(2);
    expect(page.items.map((company) => [company.id, company.recentValidationCount])).toEqual([
      ['la-espiga', 1_207],
      ['el-molino', 0],
    ]);
  });
});
