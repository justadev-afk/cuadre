/**
 * Password-reset tokens.
 *
 * The token itself never reaches this file. What is stored — and what the
 * primary key is — is its SHA-256, so a database dump is a list of hashes and
 * not a list of live reset links. `findByTokenHash` therefore takes the hash of
 * whatever arrived in the URL; the caller hashes, this file looks up.
 *
 * The `requested_ip` column holds `hashIp()` output for the same reason. The
 * field is named for what it contains rather than for the column, because the
 * one thing that must not happen here is somebody writing a raw address into a
 * column whose name invites it.
 */
import { type D1Row, integer, optionalInteger, optionalText, text } from './row.ts';

export type PasswordReset = {
  readonly tokenHash: string;
  readonly userId: string;
  readonly expiresAt: number;
  /** `null` while the token is still spendable. */
  readonly usedAt: number | null;
  readonly requestedIpHash: string | null;
  readonly createdAt: number;
};

export type NewPasswordReset = {
  readonly tokenHash: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly requestedIpHash: string | null;
  readonly createdAt: number;
};

export interface PasswordResetRepository {
  create(input: NewPasswordReset): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<PasswordReset | null>;
  /** `false` when the token was already spent or has expired. Single-use, atomically. */
  markUsed(tokenHash: string, at: number): Promise<boolean>;
  /** Called after a successful reset and after a password change. Returns rows burned. */
  invalidateAllForUser(userId: string, at: number): Promise<number>;
  /** The 3-per-hour cap: `since` is the window floor in epoch seconds. */
  countRecentForUser(userId: string, since: number): Promise<number>;
}

const COLUMNS = 'token_hash, user_id, expires_at, used_at, requested_ip, created_at';

export class D1PasswordResetRepository implements PasswordResetRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: NewPasswordReset): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO password_resets
             (token_hash, user_id, expires_at, requested_ip, created_at)
           VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(input.tokenHash, input.userId, input.expiresAt, input.requestedIpHash, input.createdAt)
      .run();
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordReset | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM password_resets WHERE token_hash = ?`)
      .bind(tokenHash)
      .first<D1Row>();
    return row === null ? null : toPasswordReset(row);
  }

  /**
   * The conditions live in the UPDATE, not in a read before it. Two clicks on
   * the same mailed link a moment apart would both pass a check-then-write
   * and both be allowed to set a password; here the second one changes no
   * rows and is refused.
   */
  async markUsed(tokenHash: string, at: number): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE password_resets SET used_at = ?
            WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?`,
      )
      .bind(at, tokenHash, at)
      .run();
    return result.meta.changes === 1;
  }

  /**
   * Marks the outstanding tokens spent rather than deleting them: the rows
   * are the audit trail of who asked for a reset and when, which is the first
   * thing anyone wants after an account is taken over.
   */
  async invalidateAllForUser(userId: string, at: number): Promise<number> {
    const result = await this.db
      .prepare('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL')
      .bind(at, userId)
      .run();
    return result.meta.changes;
  }

  /**
   * Counts requests, not live tokens — an expired or already-spent token
   * still cost us an email, and the cap exists to stop this address being
   * used to mail somebody repeatedly.
   */
  async countRecentForUser(userId: string, since: number): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM password_resets
            WHERE user_id = ? AND created_at >= ?`,
      )
      .bind(userId, since)
      .first<D1Row>();
    return row === null ? 0 : integer(row, 'total');
  }
}

export function toPasswordReset(row: D1Row): PasswordReset {
  return {
    tokenHash: text(row, 'token_hash'),
    userId: text(row, 'user_id'),
    expiresAt: integer(row, 'expires_at'),
    usedAt: optionalInteger(row, 'used_at'),
    requestedIpHash: optionalText(row, 'requested_ip'),
    createdAt: integer(row, 'created_at'),
  };
}
