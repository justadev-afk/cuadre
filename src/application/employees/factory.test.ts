import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { fakeIdGen } from '../../shared/id.ts';
import { makeEmployeeUseCases } from './factory.ts';
import { makeFakeSessions, makeFakeUserStore } from './user-store.fake.ts';

describe('makeEmployeeUseCases', () => {
  it('builds every company-area use case over one set of adapters', async () => {
    // The container's shape, in miniature: two collaborators satisfying the
    // union of what the four use cases each declared for themselves. If a port
    // and an adapter ever disagree, this line is where it shows.
    const useCases = makeEmployeeUseCases({
      users: makeFakeUserStore([{ id: 'maria', companyId: 'la-espiga' }]),
      sessions: makeFakeSessions().store,
      clock: fixedClock(1_770_000_000),
      idGen: fakeIdGen({ uuids: ['cashier-uuid'] }),
    });

    expect(Object.keys(useCases).sort()).toEqual([
      'changeOwnPassword',
      'createEmployee',
      'listEmployees',
      'updateEmployee',
    ]);
    expect(await useCases.listEmployees({ companyId: 'la-espiga' })).toHaveLength(1);
  });
});
