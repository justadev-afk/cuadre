/**
 * An in-memory `users` table for the employee use cases, hand written so no
 * test has to mock one of our own modules.
 *
 * It copies the one asymmetry the real statements have and the port signatures
 * do not: `listByCompany` filters on `company_id`, while `findById`,
 * `updateProfile`, `setPasswordHash` and `setStatus` are keyed by the
 * uuid **alone** — exactly as the D1 statements in
 * `src/adapters/d1/user.repository.ts` are. That asymmetry is the point of
 * this fake. A use case that writes through an id without first establishing
 * whose it is will cheerfully corrupt another merchant's row here, and the
 * scoping tests are what catch it.
 *
 * `writes` records every mutating call so a test can assert that a refusal
 * wrote nothing at all, rather than only that it answered with an error.
 */
import { err, ok, type Result } from '../../shared/result.ts';
import type { EmployeeStatus } from './employee.ts';

export type FakeUserRow = {
  id: string;
  companyId: string;
  role: string;
  name: string;
  email: string | null;
  username: string | null;
  passwordHash: string;
  status: EmployeeStatus;
  lastLoginAt: number | null;
  createdAt: number;
};

type WriteFailure =
  | 'email_taken'
  | 'username_taken'
  | 'invalid_for_role'
  | 'unknown_company'
  | 'not_found';

type Visible = Omit<FakeUserRow, 'passwordHash'>;

export type FakeUserStore = {
  readonly rows: FakeUserRow[];
  readonly writes: string[];
  createUser(input: {
    readonly id: string;
    readonly companyId: string;
    readonly role: string;
    readonly name: string;
    readonly email: string | null;
    readonly username: string | null;
    readonly passwordHash: string;
    readonly createdAt: number;
  }): Promise<Result<Visible, WriteFailure>>;
  findById(id: string): Promise<Visible | null>;
  findByEmail(email: string): Promise<FakeUserRow | null>;
  listByCompany(companyId: string, role?: string): Promise<readonly Visible[]>;
  updateProfile(
    id: string,
    patch: { readonly name?: string },
  ): Promise<Result<Visible, WriteFailure>>;
  setPasswordHash(id: string, passwordHash: string): Promise<Result<void, WriteFailure>>;
  setStatus(id: string, status: EmployeeStatus): Promise<Result<Visible, WriteFailure>>;
};

export function makeFakeUserStore(seed: readonly Partial<FakeUserRow>[] = []): FakeUserStore {
  const rows: FakeUserRow[] = seed.map(userRow);
  const writes: string[] = [];

  const find = (id: string) => rows.find((row) => row.id === id) ?? null;

  return {
    rows,
    writes,

    async createUser(input) {
      writes.push(`createUser:${input.id}`);
      if (input.email !== null && rows.some((row) => row.email === input.email)) {
        return err('email_taken');
      }
      // Partial unique index: `(company_id, username)` where username is not null.
      if (
        input.username !== null &&
        rows.some((row) => row.companyId === input.companyId && row.username === input.username)
      ) {
        return err('username_taken');
      }
      const row = userRow(input);
      rows.push(row);
      return ok(visible(row));
    },

    async findById(id) {
      const row = find(id);
      return row === null ? null : visible(row);
    },

    async findByEmail(email) {
      return rows.find((row) => row.email === email) ?? null;
    },

    async listByCompany(companyId, role) {
      return rows
        .filter((row) => row.companyId === companyId && (role === undefined || row.role === role))
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(visible);
    },

    async updateProfile(id, patch) {
      writes.push(`updateProfile:${id}`);
      const row = find(id);
      if (row === null) return err('not_found');
      if (patch.name !== undefined) row.name = patch.name;
      return ok(visible(row));
    },

    async setPasswordHash(id, passwordHash) {
      writes.push(`setPasswordHash:${id}`);
      const row = find(id);
      if (row === null) return err('not_found');
      row.passwordHash = passwordHash;
      return ok(undefined);
    },

    // There is no delete. A user row outlives the person's access, because
    // `validations.cashier_id` names them on every payment they confirmed.
    async setStatus(id, status) {
      writes.push(`setStatus:${id}:${status}`);
      const row = find(id);
      if (row === null) return err('not_found');
      row.status = status;
      return ok(visible(row));
    },
  };
}

/** The session store's one call, and a record of who it was asked about. */
export function makeFakeSessions(perUser = 1) {
  const revoked: string[] = [];
  return {
    revoked,
    store: {
      async deleteAllForUser(userId: string): Promise<number> {
        revoked.push(userId);
        return perUser;
      },
    },
  };
}

function userRow(overrides: Partial<FakeUserRow>): FakeUserRow {
  return {
    id: 'user-1',
    companyId: 'la-espiga',
    role: 'cashier',
    name: 'María Rodríguez',
    email: null,
    username: 'maria.r',
    passwordHash: 'pbkdf2$1$c2FsdA==$aGFzaA==',
    status: 'active',
    lastLoginAt: null,
    createdAt: 1_760_000_000,
    ...overrides,
  };
}

/** `findById` and the write paths never carry the hash, exactly as D1 does not. */
function visible(row: FakeUserRow): Visible {
  const { passwordHash: _hash, ...rest } = row;
  return rest;
}
