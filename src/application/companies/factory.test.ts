import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { fakeIdGen } from '../../shared/id.ts';
import { ok, type Result } from '../../shared/result.ts';
import { makeFakeBankAccounts, makeFakeCompanyStore } from './company-store.fake.ts';
import { makeCompanyUseCases } from './factory.ts';

describe('makeCompanyUseCases', () => {
  it('builds every admin use case over one set of adapters', async () => {
    // The container's shape, in miniature: four collaborators satisfying the
    // union of what the four use cases each declared for themselves. If a port
    // and an adapter ever disagree, this line is where it shows.
    const useCases = makeCompanyUseCases({
      companies: makeFakeCompanyStore([{ id: 'la-espiga' }]),
      users: {
        async findByEmail() {
          return null;
        },
        async createUser(input): Promise<Result<{ id: string }, never>> {
          return ok({ id: input.id });
        },
      },
      bankAccounts: makeFakeBankAccounts(),
      clock: fixedClock(1_770_000_000),
      idGen: fakeIdGen({ uuids: ['admin-uuid'] }),
    });

    expect(Object.keys(useCases).sort()).toEqual([
      'createCompany',
      'getCompany',
      'listCompanies',
      'updateCompany',
    ]);
    expect((await useCases.listCompanies({})).total).toBe(1);
  });
});
