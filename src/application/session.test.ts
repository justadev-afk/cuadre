import { describe, expect, it } from 'vitest';

import {
  type Area,
  canReach,
  expiredSessionCookie,
  homeAreaFor,
  isRole,
  type Role,
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  type SessionRecord,
  type StoredSession,
  sessionCookie,
  toSessionRecord,
} from './session.ts';

const RECORD: SessionRecord = {
  userId: 'user-1',
  role: 'cashier',
  companyId: 'la-espiga',
  name: 'María R.',
  username: 'maria.r',
  email: null,
  createdAt: 1_770_000_000,
  shiftAckAt: 1_770_000_000,
  ipHash: 'b1946ac92492d2347c6235b4d2611184',
};

describe('isRole', () => {
  const table: ReadonlyArray<{ value: string; expected: boolean; why: string }> = [
    { value: 'admin', expected: true, why: 'the platform team' },
    { value: 'company', expected: true, why: 'the merchant administrator' },
    { value: 'cashier', expected: true, why: 'the counter' },
    { value: 'supervisor', expected: false, why: 'dropped in migration 0002' },
    { value: 'Admin', expected: false, why: 'the column is lowercase' },
    { value: '', expected: false, why: 'nothing at all' },
  ];

  for (const { value, expected, why } of table) {
    it(`${JSON.stringify(value)} → ${expected} (${why})`, () => {
      expect(isRole(value)).toBe(expected);
    });
  }
});

describe('toSessionRecord', () => {
  it('narrows a record this build understands', () => {
    const stored: StoredSession = { ...RECORD, role: 'company' };
    expect(toSessionRecord(stored)).toEqual({ ...RECORD, role: 'company' });
  });

  it('refuses a role that no longer exists rather than downgrading it', () => {
    // A session written before 0002 dropped the tier. Sessions never expire on
    // their own, so this record can outlive the deploy that wrote it.
    expect(toSessionRecord({ ...RECORD, role: 'supervisor' })).toBeNull();
  });

  it('keeps every other field untouched', () => {
    const narrowed = toSessionRecord({ ...RECORD, role: 'admin', companyId: null });
    expect(narrowed?.companyId).toBeNull();
    expect(narrowed?.ipHash).toBe(RECORD.ipHash);
  });
});

describe('canReach', () => {
  const table: ReadonlyArray<{ role: Role; area: Area; expected: boolean; why: string }> = [
    { role: 'admin', area: 'admin', expected: true, why: 'its own panel' },
    {
      role: 'admin',
      area: 'company',
      expected: false,
      why: 'an admin has no company_id and every query there is scoped by one',
    },
    { role: 'admin', area: 'counter', expected: false, why: 'nobody validates on their behalf' },
    { role: 'company', area: 'company', expected: true, why: 'the merchant panel' },
    { role: 'company', area: 'admin', expected: false, why: 'the platform is not theirs' },
    {
      role: 'company',
      area: 'counter',
      expected: true,
      why: 'a small merchant is often the one at the till',
    },
    { role: 'cashier', area: 'counter', expected: true, why: 'the checkout screen' },
    { role: 'cashier', area: 'company', expected: false, why: 'no access to the history' },
    { role: 'cashier', area: 'admin', expected: false, why: 'plainly not' },
  ];

  for (const { role, area, expected, why } of table) {
    it(`${role} → ${area} is ${expected} (${why})`, () => {
      expect(canReach(role, area)).toBe(expected);
    });
  }
});

describe('homeAreaFor', () => {
  const table: ReadonlyArray<{ role: Role; expected: Area }> = [
    { role: 'admin', expected: 'admin' },
    { role: 'company', expected: 'company' },
    { role: 'cashier', expected: 'counter' },
  ];

  for (const { role, expected } of table) {
    it(`sends ${role} to ${expected}`, () => {
      expect(homeAreaFor(role)).toBe(expected);
    });
  }

  it('never lands a role somewhere the guard would bounce it', () => {
    for (const role of ['admin', 'company', 'cashier'] as const) {
      expect(canReach(role, homeAreaFor(role))).toBe(true);
    }
  });
});

describe('the cookie', () => {
  it('carries the id and every attribute the design fixed', () => {
    const header = sessionCookie('sess-abc');

    expect(header.startsWith('cuadre_session=sess-abc; ')).toBe(true);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Secure');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Path=/');
  });

  it('is persistent, over the same window the record idles for', () => {
    expect(sessionCookie('sess-abc')).toContain(`Max-Age=${SESSION_MAX_AGE_SECONDS}`);
    expect(SESSION_COOKIE.maxAgeSeconds).toBe(SESSION_MAX_AGE_SECONDS);
  });

  it('clears with the same attributes it was set with', () => {
    // A Set-Cookie that drops Path addresses a different cookie, which is to
    // say it deletes nothing and the user stays signed in.
    const cleared = expiredSessionCookie();

    expect(cleared.startsWith('cuadre_session=; ')).toBe(true);
    expect(cleared).toContain('Max-Age=0');
    expect(cleared).toContain('Path=/');
    expect(cleared).toContain('HttpOnly');
    expect(cleared).toContain('Secure');
    expect(cleared).toContain('SameSite=Lax');
  });
});
