import { describe, expect, it } from 'vitest';

import { fixedClock } from '../../shared/clock.ts';
import { sha256Hex } from '../../shared/crypto.ts';
import { fakeIdGen } from '../../shared/id.ts';
import {
  CASHIER_USER,
  COMPANY_USER,
  type FakeResetRow,
  makeFakeJobs,
  makeFakeResets,
  makeFakeUsers,
} from './auth.fake.ts';
import {
  MAX_RESETS_PER_HOUR,
  makeRequestPasswordReset,
  RESET_TOKEN_TTL_SECONDS,
  type RequestPasswordResetDeps,
} from './request-password-reset.ts';

const NOW = 1_770_000_000;
const TOKEN = 'a3f1c0de';
const IP_HASH = 'b1946ac92492d2347c6235b4d2611184';

function setUp(seed: readonly FakeResetRow[] = []) {
  const users = makeFakeUsers([COMPANY_USER, CASHIER_USER]);
  const resets = makeFakeResets(seed);
  const jobs = makeFakeJobs();

  const deps: RequestPasswordResetDeps = {
    users: users.users,
    resets: resets.resets,
    jobs: jobs.jobs,
    clock: fixedClock(NOW),
    ids: fakeIdGen({ tokens: [TOKEN] }),
    appBaseUrl: 'https://cuadre.jsansossio.com',
  };

  return { deps, users, resets, jobs };
}

function row(overrides: Partial<FakeResetRow> = {}): FakeResetRow {
  return {
    tokenHash: 'old-hash',
    userId: COMPANY_USER.id,
    expiresAt: NOW + 60,
    usedAt: null,
    requestedIpHash: IP_HASH,
    createdAt: NOW - 120,
    ...overrides,
  };
}

describe('an address we know', () => {
  it('stores the hash of the token and never the token', async () => {
    const { deps, resets } = setUp();

    await makeRequestPasswordReset(deps)({ email: 'ana@laespiga.com', ipHash: IP_HASH });

    const hash = await sha256Hex(TOKEN);
    expect([...resets.rows.keys()]).toEqual([hash]);
    expect(resets.rows.get(hash)).toEqual({
      tokenHash: hash,
      userId: 'user-company',
      expiresAt: NOW + RESET_TOKEN_TTL_SECONDS,
      usedAt: null,
      requestedIpHash: IP_HASH,
      createdAt: NOW,
    });
  });

  it('gives the link half an hour', async () => {
    const { deps, resets } = setUp();

    await makeRequestPasswordReset(deps)({ email: 'ana@laespiga.com', ipHash: IP_HASH });

    const stored = resets.rows.get(await sha256Hex(TOKEN));
    expect((stored?.expiresAt ?? 0) - NOW).toBe(30 * 60);
  });

  it('queues the mail instead of sending it inline', async () => {
    const { deps, jobs } = setUp();

    await makeRequestPasswordReset(deps)({ email: 'ana@laespiga.com', ipHash: IP_HASH });

    expect(jobs.enqueued).toEqual([
      {
        kind: 'send_password_reset',
        to: 'ana@laespiga.com',
        resetUrl: `https://cuadre.jsansossio.com/reset-password?token=${TOKEN}`,
        name: 'Ana P.',
      },
    ]);
  });

  it('builds the link off APP_BASE_URL without doubling a slash', async () => {
    const { deps, jobs } = setUp();

    await makeRequestPasswordReset({ ...deps, appBaseUrl: 'https://cuadre.ve/' })({
      email: 'ana@laespiga.com',
      ipHash: IP_HASH,
    });

    expect(jobs.enqueued[0]?.resetUrl).toBe(`https://cuadre.ve/reset-password?token=${TOKEN}`);
  });

  it('burns the links asked for earlier', async () => {
    const { deps, resets } = setUp([row()]);

    await makeRequestPasswordReset(deps)({ email: 'ana@laespiga.com', ipHash: IP_HASH });

    // Two live links means the older mail — the one more likely to have been
    // forwarded or left open — still opens the door.
    expect(resets.rows.get('old-hash')?.usedAt).toBe(NOW);
    expect(resets.rows.get(await sha256Hex(TOKEN))?.usedAt).toBeNull();
  });

  it('finds the account whatever case it was typed in', async () => {
    const { deps, jobs } = setUp();

    await makeRequestPasswordReset(deps)({ email: ' Ana@LaEspiga.com ', ipHash: IP_HASH });

    expect(jobs.enqueued).toHaveLength(1);
  });
});

describe('an address we do not know', () => {
  it('answers exactly what a registered one answers', async () => {
    const { deps } = setUp();
    const request = makeRequestPasswordReset(deps);

    const known = await request({ email: 'ana@laespiga.com', ipHash: IP_HASH });
    const unknown = await request({ email: 'nobody@nowhere.com', ipHash: IP_HASH });

    // Both `undefined`, and there is nothing else for a screen to branch on:
    // a reset form that confirms an address is a customer list anybody can
    // download one address at a time.
    expect(known).toBeUndefined();
    expect(unknown).toBeUndefined();
  });

  it('mints nothing and mails nobody', async () => {
    const { deps, resets, jobs } = setUp();

    await makeRequestPasswordReset(deps)({ email: 'nobody@nowhere.com', ipHash: IP_HASH });

    expect(resets.rows.size).toBe(0);
    expect(jobs.enqueued).toEqual([]);
  });
});

describe('who never gets one', () => {
  it('a cashier: their PIN is reset by the company they work for', async () => {
    const withEmail = makeFakeUsers([{ ...CASHIER_USER, email: 'maria@laespiga.com' }]);
    const { deps, jobs, resets } = setUp();

    await makeRequestPasswordReset({ ...deps, users: withEmail.users })({
      email: 'maria@laespiga.com',
      ipHash: IP_HASH,
    });

    expect(jobs.enqueued).toEqual([]);
    expect(resets.rows.size).toBe(0);
  });

  it('a disabled account', async () => {
    const disabled = makeFakeUsers([{ ...COMPANY_USER, status: 'disabled' }]);
    const { deps, jobs } = setUp();

    await makeRequestPasswordReset({ ...deps, users: disabled.users })({
      email: 'ana@laespiga.com',
      ipHash: IP_HASH,
    });

    expect(jobs.enqueued).toEqual([]);
  });
});

describe('the three-an-hour cap', () => {
  it('still sends the third', async () => {
    const seed = [
      row({ tokenHash: 'h1', createdAt: NOW - 3000 }),
      row({ tokenHash: 'h2', createdAt: NOW - 600 }),
    ];
    const { deps, jobs } = setUp(seed);

    await makeRequestPasswordReset(deps)({ email: 'ana@laespiga.com', ipHash: IP_HASH });

    expect(jobs.enqueued).toHaveLength(1);
  });

  it('sends nothing on the fourth, and says so no differently', async () => {
    const seed = Array.from({ length: MAX_RESETS_PER_HOUR }, (_, index) =>
      row({ tokenHash: `h${index}`, createdAt: NOW - 60 * index }),
    );
    const { deps, jobs, resets } = setUp(seed);

    const answer = await makeRequestPasswordReset(deps)({
      email: 'ana@laespiga.com',
      ipHash: IP_HASH,
    });

    expect(answer).toBeUndefined();
    expect(jobs.enqueued).toEqual([]);
    expect(resets.rows.size).toBe(MAX_RESETS_PER_HOUR);
  });

  it('counts the window, not the history', async () => {
    const seed = Array.from({ length: MAX_RESETS_PER_HOUR }, (_, index) =>
      row({ tokenHash: `h${index}`, createdAt: NOW - 3600 - index }),
    );
    const { deps, jobs } = setUp(seed);

    await makeRequestPasswordReset(deps)({ email: 'ana@laespiga.com', ipHash: IP_HASH });

    // Yesterday's three requests are not this hour's.
    expect(jobs.enqueued).toHaveLength(1);
  });
});
