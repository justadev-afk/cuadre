/**
 * Hand-written fakes of the ports the auth use cases declare.
 *
 * They are shared by the nine test files here for the same reason
 * `src/adapters/d1/d1.fake.ts` is shared: nine copies of a Map behind an
 * interface drift, and the moment one of them behaves differently a test is
 * pinning the fake instead of the use case.
 *
 * Nothing here is a mock framework. `vi.mock` on our own modules would mean a
 * port is missing, and these exist precisely because none is.
 */
import type { Result } from '../../shared/result.ts';
import type { SessionRecord, StoredSession } from '../session.ts';
import type { AuthenticatingUser, RateLimitPolicy } from './sign-in.ts';

// ── sessions ───────────────────────────────────────────────────────────────

export type FakeSessions = {
  readonly sessions: {
    put(id: string, record: SessionRecord): Promise<void>;
    touch(id: string): Promise<StoredSession | null>;
    ackShift(id: string, at: number): Promise<StoredSession | null>;
    delete(id: string): Promise<void>;
    deleteAllForUser(userId: string): Promise<number>;
  };
  /** Keyed by session id. `StoredSession` so a test can plant a role we dropped. */
  readonly records: Map<string, StoredSession>;
  /** Every id `touch` was called with, in order. Proves the TTL was renewed. */
  readonly touched: string[];
};

export function makeFakeSessions(seed: Record<string, StoredSession> = {}): FakeSessions {
  const records = new Map<string, StoredSession>(Object.entries(seed));
  const touched: string[] = [];

  return {
    records,
    touched,
    sessions: {
      async put(id, record) {
        records.set(id, record);
      },

      async touch(id) {
        touched.push(id);
        return records.get(id) ?? null;
      },

      async ackShift(id, at) {
        const current = records.get(id);
        if (current === undefined) return null;
        const acknowledged = { ...current, shiftAckAt: at };
        records.set(id, acknowledged);
        return acknowledged;
      },

      async delete(id) {
        records.delete(id);
      },

      async deleteAllForUser(userId) {
        const doomed = [...records.entries()].filter(([, r]) => r.userId === userId);
        for (const [id] of doomed) records.delete(id);
        return doomed.length;
      },
    },
  };
}

// ── users ──────────────────────────────────────────────────────────────────

export type FakeUsers = {
  readonly users: {
    findByEmail(email: string): Promise<AuthenticatingUser | null>;
    findByCompanyAndUsername(
      companyId: string,
      username: string,
    ): Promise<AuthenticatingUser | null>;
    touchLastLogin(id: string, at: number): Promise<void>;
    setPasswordHash(id: string, passwordHash: string): Promise<Result<void, string>>;
  };
  readonly rows: AuthenticatingUser[];
  readonly lastLogins: { id: string; at: number }[];
  /** Exactly what each lookup was asked for, so normalisation is testable. */
  readonly lookups: { by: 'email' | 'login'; key: string }[];
};

export function makeFakeUsers(seed: readonly AuthenticatingUser[] = []): FakeUsers {
  const rows = [...seed];
  const lastLogins: { id: string; at: number }[] = [];
  const lookups: { by: 'email' | 'login'; key: string }[] = [];

  return {
    rows,
    lastLogins,
    lookups,
    users: {
      async findByEmail(email) {
        lookups.push({ by: 'email', key: email });
        return rows.find((row) => row.email === email) ?? null;
      },

      async findByCompanyAndUsername(companyId, username) {
        lookups.push({ by: 'login', key: `${companyId}:${username}` });
        return rows.find((row) => row.companyId === companyId && row.username === username) ?? null;
      },

      async touchLastLogin(id, at) {
        lastLogins.push({ id, at });
      },

      async setPasswordHash(id, passwordHash) {
        const index = rows.findIndex((row) => row.id === id);
        if (index === -1) return { ok: false, error: 'not_found' };
        const row = rows[index];
        rows[index] = { ...row, passwordHash };
        return { ok: true, value: undefined };
      },
    },
  };
}

// ── companies ──────────────────────────────────────────────────────────────

export type FakeCompanies = {
  readonly companies: { findById(id: string): Promise<{ readonly status: string } | null> };
  readonly lookups: string[];
};

export function makeFakeCompanies(statuses: Record<string, string> = {}): FakeCompanies {
  const lookups: string[] = [];
  return {
    lookups,
    companies: {
      async findById(id) {
        lookups.push(id);
        const status = statuses[id];
        return status === undefined ? null : { status };
      },
    },
  };
}

// ── the rate limiter ───────────────────────────────────────────────────────

export type FakeLimiter = {
  readonly limiter: {
    hit(
      scope: string,
      key: string,
      policy: RateLimitPolicy,
    ): Promise<{ readonly allowed: boolean }>;
    reset(scope: string, key: string, policy: RateLimitPolicy): Promise<void>;
  };
  readonly hits: { scope: string; key: string; policy: RateLimitPolicy }[];
  readonly resets: { scope: string; key: string }[];
  /** Refuses every subsequent `hit` on that scope, whatever the count says. */
  refuse(scope: string): void;
};

export function makeFakeLimiter(): FakeLimiter {
  const counts = new Map<string, number>();
  const hits: { scope: string; key: string; policy: RateLimitPolicy }[] = [];
  const resets: { scope: string; key: string }[] = [];
  const refused = new Set<string>();

  return {
    hits,
    resets,
    refuse: (scope) => {
      refused.add(scope);
    },
    limiter: {
      async hit(scope, key, policy) {
        hits.push({ scope, key, policy });
        const name = `${scope}:${key}`;
        const used = (counts.get(name) ?? 0) + 1;
        counts.set(name, used);
        return { allowed: !refused.has(scope) && used <= policy.limit };
      },

      async reset(scope, key) {
        resets.push({ scope, key });
        counts.delete(`${scope}:${key}`);
      },
    },
  };
}

// ── passwords ──────────────────────────────────────────────────────────────

/**
 * A stand-in for PBKDF2. The real one costs 100 000 iterations a call, which a
 * test that only cares about *which string was verified against what* has no
 * reason to pay — and the calls are recorded, which is the only way to hold the
 * absent-user path to hashing something.
 */
export type FakePasswords = {
  readonly passwords: {
    hash(plaintext: string): Promise<string>;
    verify(plaintext: string, storedHash: string): Promise<boolean>;
  };
  readonly verified: { plaintext: string; storedHash: string }[];
};

export function fakeHashOf(plaintext: string): string {
  return `hashed:${plaintext}`;
}

export function makeFakePasswords(): FakePasswords {
  const verified: { plaintext: string; storedHash: string }[] = [];
  return {
    verified,
    passwords: {
      async hash(plaintext) {
        return fakeHashOf(plaintext);
      },

      async verify(plaintext, storedHash) {
        verified.push({ plaintext, storedHash });
        return storedHash === fakeHashOf(plaintext);
      },
    },
  };
}

// ── the queue ──────────────────────────────────────────────────────────────

export type EnqueuedJob = {
  readonly kind: 'send_password_reset';
  readonly to: string;
  readonly resetUrl: string;
  readonly name: string;
};

export type FakeJobs = {
  readonly jobs: { enqueue(job: EnqueuedJob): Promise<void> };
  readonly enqueued: EnqueuedJob[];
};

export function makeFakeJobs(): FakeJobs {
  const enqueued: EnqueuedJob[] = [];
  return {
    enqueued,
    jobs: {
      async enqueue(job) {
        enqueued.push(job);
      },
    },
  };
}

// ── password-reset tokens ──────────────────────────────────────────────────

export type FakeResetRow = {
  tokenHash: string;
  userId: string;
  expiresAt: number;
  usedAt: number | null;
  requestedIpHash: string | null;
  createdAt: number;
};

export type FakeResets = {
  readonly resets: {
    create(input: {
      readonly tokenHash: string;
      readonly userId: string;
      readonly expiresAt: number;
      readonly requestedIpHash: string | null;
      readonly createdAt: number;
    }): Promise<void>;
    findByTokenHash(tokenHash: string): Promise<{ readonly userId: string } | null>;
    markUsed(tokenHash: string, at: number): Promise<boolean>;
    invalidateAllForUser(userId: string, at: number): Promise<number>;
    countRecentForUser(userId: string, since: number): Promise<number>;
  };
  readonly rows: Map<string, FakeResetRow>;
  /** Every hash `findByTokenHash` was asked for — the token itself must never appear. */
  readonly lookups: string[];
};

export function makeFakeResets(seed: readonly FakeResetRow[] = []): FakeResets {
  const rows = new Map<string, FakeResetRow>(seed.map((row) => [row.tokenHash, { ...row }]));
  const lookups: string[] = [];

  return {
    rows,
    lookups,
    resets: {
      async create(input) {
        rows.set(input.tokenHash, { ...input, usedAt: null });
      },

      async findByTokenHash(tokenHash) {
        lookups.push(tokenHash);
        return rows.get(tokenHash) ?? null;
      },

      // The conditions live in the write, exactly as they do in the UPDATE the
      // repository sends: a second click must change no rows.
      async markUsed(tokenHash, at) {
        const row = rows.get(tokenHash);
        if (row === undefined || row.usedAt !== null || row.expiresAt <= at) return false;
        rows.set(tokenHash, { ...row, usedAt: at });
        return true;
      },

      async invalidateAllForUser(userId, at) {
        let burned = 0;
        for (const [hash, row] of rows) {
          if (row.userId !== userId || row.usedAt !== null) continue;
          rows.set(hash, { ...row, usedAt: at });
          burned += 1;
        }
        return burned;
      },

      async countRecentForUser(userId, since) {
        return [...rows.values()].filter((row) => row.userId === userId && row.createdAt >= since)
          .length;
      },
    },
  };
}

// ── users, for the tests that need one ─────────────────────────────────────

export const COMPANY_USER: AuthenticatingUser = {
  id: 'user-company',
  companyId: 'la-espiga',
  role: 'company',
  name: 'Ana P.',
  email: 'ana@laespiga.com',
  username: null,
  status: 'active',
  passwordHash: fakeHashOf('correct horse'),
};

export const ADMIN_USER: AuthenticatingUser = {
  id: 'user-admin',
  companyId: null,
  role: 'admin',
  name: 'Julio S.',
  email: 'julio@cuadre.ve',
  username: null,
  status: 'active',
  passwordHash: fakeHashOf('platform pass'),
};

export const CASHIER_USER: AuthenticatingUser = {
  id: 'user-cashier',
  companyId: 'la-espiga',
  role: 'cashier',
  name: 'María R.',
  email: null,
  username: 'maria.r',
  status: 'active',
  passwordHash: fakeHashOf('8317'),
};
