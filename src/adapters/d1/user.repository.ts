/**
 * Users — all four roles in one table, told apart by which credential
 * identifies them.
 *
 * Three CHECK constraints and two partial unique indexes encode that: a cashier
 * has a username and no email, everyone else the reverse, and only a platform
 * admin has no company. Every one of them can be violated by a bad call, and a
 * bad call must come back as a value the caller can branch on — `email_taken`,
 * `invalid_for_role` — never as D1's error string leaking into a 500.
 *
 * The password hash is deliberately not on `User`. A handler that reaches for
 * the hash has to ask for `UserWithSecret` by name, so no serialiser can put it
 * in a response by accident.
 */
import { AppError } from '../../shared/errors.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { isUniqueIndex, readConstraintFailure, type UniqueIndex } from './constraint-error.ts';
import { type D1Row, integer, optionalInteger, optionalText, text } from './row.ts';

export type UserRole = 'admin' | 'company' | 'cashier';
export type UserStatus = 'active' | 'disabled';

export type User = {
  readonly id: string;
  /** `null` only for a platform admin. */
  readonly companyId: string | null;
  readonly role: UserRole;
  readonly name: string;
  /** Set for every role but `cashier`. */
  readonly email: string | null;
  /** Set only for `cashier`. Half of the login tuple with `companyId`. */
  readonly username: string | null;
  readonly status: UserStatus;
  readonly lastLoginAt: number | null;
  readonly createdAt: number;
};

export type UserWithSecret = User & { readonly passwordHash: string };

export type NewUser = {
  readonly id: string;
  readonly companyId: string | null;
  readonly role: UserRole;
  readonly name: string;
  readonly email: string | null;
  readonly username: string | null;
  readonly passwordHash: string;
  readonly createdAt: number;
};

export type UserProfilePatch = {
  readonly name?: string;
  readonly email?: string | null;
  readonly username?: string | null;
};

/**
 * `invalid_for_role` is any of the three role/credential CHECKs: SQLite reports
 * an unnamed CHECK differently across versions, so which one failed is not
 * recoverable from the message — and does not need to be, because the caller's
 * remedy is the same in all three cases.
 */
export type UserWriteFailure =
  | 'email_taken'
  | 'username_taken'
  | 'invalid_for_role'
  | 'unknown_company'
  | 'not_found'
  | 'has_history';

export interface UserRepository {
  createUser(input: NewUser): Promise<Result<User, UserWriteFailure>>;
  /** Login lookup for admin and company. Carries the hash. */
  findByEmail(email: string): Promise<UserWithSecret | null>;
  /** THE cashier login tuple, exactly as it is typed on the login screen. */
  findByCompanyAndUsername(companyId: string, username: string): Promise<UserWithSecret | null>;
  findById(id: string): Promise<User | null>;
  listByCompany(companyId: string, role?: UserRole): Promise<readonly User[]>;
  updateProfile(id: string, patch: UserProfilePatch): Promise<Result<User, UserWriteFailure>>;
  setPasswordHash(id: string, passwordHash: string): Promise<Result<void, UserWriteFailure>>;
  touchLastLogin(id: string, at: number): Promise<void>;
  disable(id: string): Promise<Result<User, UserWriteFailure>>;
  remove(id: string): Promise<Result<void, UserWriteFailure>>;
}

const EMAIL_INDEX: UniqueIndex = { name: 'ux_users_email', columns: ['users.email'] };
const LOGIN_INDEX: UniqueIndex = {
  name: 'ux_users_login',
  columns: ['users.company_id', 'users.username'],
};

const COLUMNS = 'id, company_id, role, name, email, username, status, last_login_at, created_at';
const SECRET_COLUMNS = `${COLUMNS}, password_hash`;

export class D1UserRepository implements UserRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<User | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`)
      .bind(id)
      .first<D1Row>();
    return row === null ? null : toUser(row);
  }

  async createUser(input: NewUser): Promise<Result<User, UserWriteFailure>> {
    try {
      const row = await this.db
        .prepare(
          `INSERT INTO users
               (id, company_id, role, name, email, username, password_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING ${COLUMNS}`,
        )
        .bind(
          input.id,
          input.companyId,
          input.role,
          input.name,
          input.email,
          input.username,
          input.passwordHash,
          input.createdAt,
        )
        .first<D1Row>();

      if (row === null) throw new AppError('internal', 'user insert returned no row');
      return ok(toUser(row));
    } catch (error) {
      return err(classify(error, 'unknown_company'));
    }
  }

  /**
   * Matches the stored value exactly. Lower-casing an address is the domain's
   * job, done before the insert and before the lookup — doing it here with a
   * `lower(email) = ?` would also throw away `ux_users_email` and make every
   * login a table scan.
   */
  async findByEmail(email: string): Promise<UserWithSecret | null> {
    const row = await this.db
      .prepare(`SELECT ${SECRET_COLUMNS} FROM users WHERE email = ?`)
      .bind(email)
      .first<D1Row>();
    return row === null ? null : toUserWithSecret(row);
  }

  async findByCompanyAndUsername(
    companyId: string,
    username: string,
  ): Promise<UserWithSecret | null> {
    const row = await this.db
      .prepare(`SELECT ${SECRET_COLUMNS} FROM users WHERE company_id = ? AND username = ?`)
      .bind(companyId, username)
      .first<D1Row>();
    return row === null ? null : toUserWithSecret(row);
  }

  async listByCompany(companyId: string, role?: UserRole): Promise<readonly User[]> {
    // `ix_users_company` is (company_id, role), so the optional role filter
    // rides the same index rather than adding a second one.
    const statement =
      role === undefined
        ? this.db
            .prepare(`SELECT ${COLUMNS} FROM users WHERE company_id = ? ORDER BY name`)
            .bind(companyId)
        : this.db
            .prepare(
              `SELECT ${COLUMNS} FROM users
                  WHERE company_id = ? AND role = ? ORDER BY name`,
            )
            .bind(companyId, role);

    const page = await statement.all<D1Row>();
    return page.results.map(toUser);
  }

  async updateProfile(
    id: string,
    patch: UserProfilePatch,
  ): Promise<Result<User, UserWriteFailure>> {
    const sets: string[] = [];
    const args: unknown[] = [];

    if (patch.name !== undefined) {
      sets.push('name = ?');
      args.push(patch.name);
    }
    if (patch.email !== undefined) {
      sets.push('email = ?');
      args.push(patch.email);
    }
    if (patch.username !== undefined) {
      sets.push('username = ?');
      args.push(patch.username);
    }

    if (sets.length === 0) {
      const current = await this.findById(id);
      return current === null ? err('not_found') : ok(current);
    }

    return this.writeAndReturn(
      `UPDATE users SET ${sets.join(', ')} WHERE id = ? RETURNING ${COLUMNS}`,
      [...args, id],
    );
  }

  async setPasswordHash(id: string, passwordHash: string): Promise<Result<void, UserWriteFailure>> {
    const result = await this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(passwordHash, id)
      .run();
    return result.meta.changes === 0 ? err('not_found') : ok(undefined);
  }

  /**
   * Fire-and-forget on the login path: a failed write here must not turn a
   * good password into a failed login, so it does not report an outcome.
   */
  async touchLastLogin(id: string, at: number): Promise<void> {
    await this.db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(at, id).run();
  }

  /**
   * Disabling stops the *next* login. It does not end the sessions already in
   * KV — the caller must also call `deleteAllForUser` on the session store,
   * because a cashier being walked off the floor is exactly the case where
   * the live tab is the one that matters.
   */
  disable(id: string): Promise<Result<User, UserWriteFailure>> {
    return this.writeAndReturn(
      `UPDATE users SET status = 'disabled' WHERE id = ? RETURNING ${COLUMNS}`,
      [id],
    );
  }

  /**
   * A hard delete, for a user who never did anything — a mistyped invitation.
   * `validations.cashier_id` is a foreign key, so a cashier who has confirmed
   * even one payment cannot be deleted and comes back as `has_history`; that
   * user gets `disable` instead. The reset tokens go first in the same batch,
   * which is atomic, so a refused delete leaves them standing too.
   */
  async remove(id: string): Promise<Result<void, UserWriteFailure>> {
    try {
      const results = await this.db.batch([
        this.db.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(id),
        this.db.prepare('DELETE FROM users WHERE id = ?').bind(id),
      ]);
      const deleted = results.at(-1);
      if (deleted === undefined || deleted.meta.changes === 0) return err('not_found');
      return ok(undefined);
    } catch (error) {
      return err(classify(error, 'has_history'));
    }
  }

  private async writeAndReturn(
    sql: string,
    args: readonly unknown[],
  ): Promise<Result<User, UserWriteFailure>> {
    try {
      const row = await this.db
        .prepare(sql)
        .bind(...args)
        .first<D1Row>();
      return row === null ? err('not_found') : ok(toUser(row));
    } catch (error) {
      return err(classify(error, 'unknown_company'));
    }
  }
}

/**
 * `onForeignKey` is supplied by the call site because SQLite says only
 * "FOREIGN KEY constraint failed" — never which key, nor in which direction.
 * A write to `users` can only trip `company_id`; a delete of one can only trip
 * `validations.cashier_id` pointing back at it. The statement knows which it
 * was, so it says so rather than this function guessing from a string.
 */
function classify(error: unknown, onForeignKey: UserWriteFailure): UserWriteFailure {
  const failure = readConstraintFailure(error);
  if (failure === null) throw error;
  if (isUniqueIndex(failure, EMAIL_INDEX)) return 'email_taken';
  if (isUniqueIndex(failure, LOGIN_INDEX)) return 'username_taken';
  if (failure.kind === 'check') return 'invalid_for_role';
  if (failure.kind === 'foreign_key') return onForeignKey;
  throw error;
}

export function toUser(row: D1Row): User {
  return {
    id: text(row, 'id'),
    companyId: optionalText(row, 'company_id'),
    role: toRole(text(row, 'role')),
    name: text(row, 'name'),
    email: optionalText(row, 'email'),
    username: optionalText(row, 'username'),
    status: toStatus(text(row, 'status')),
    lastLoginAt: optionalInteger(row, 'last_login_at'),
    createdAt: integer(row, 'created_at'),
  };
}

export function toUserWithSecret(row: D1Row): UserWithSecret {
  return { ...toUser(row), passwordHash: text(row, 'password_hash') };
}

/**
 * Fails to the least privilege. An unreadable role must never read as `admin`,
 * and a `supervisor` left by a pre-0002 row collapses to `cashier` rather than
 * granting an area the product no longer has.
 */
function toRole(value: string): UserRole {
  if (value === 'admin' || value === 'company') return value;
  return 'cashier';
}

/** Fails closed, for the same reason a company's status does. */
function toStatus(value: string): UserStatus {
  return value === 'active' ? 'active' : 'disabled';
}
