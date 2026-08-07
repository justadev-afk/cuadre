/**
 * Spending a reset link: the token from the URL becomes a new password.
 *
 * What arrives is compared as a SHA-256 and never as itself — the database
 * holds hashes, so a dump of `password_resets` is a list of dead strings rather
 * than a list of live links. There is no lookup by user id here either; the
 * token *is* the claim.
 *
 * Single use, and the claim is made by the write. `markUsed` carries its
 * conditions in the UPDATE, so two clicks on the same link a moment apart do
 * not both pass a check that ran before either of them wrote.
 *
 * On success every session that user has anywhere is closed. A password is
 * usually reset because somebody else might have had the old one, and leaving
 * the tab they were already signed in on alive answers the wrong half of that.
 */
import { isValidPassword } from '../../domain/credentials.ts';
import type { Clock } from '../../shared/clock.ts';
import { sha256Hex } from '../../shared/crypto.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';

export type ResetPasswordInput = {
  /** As it came out of the link. Hashed here, compared as a hash, never stored. */
  readonly token: string;
  readonly newPassword: string;
};

/**
 * Expired, already spent and never issued are one answer: they are the same
 * fact — this link does not work — and separating them tells whoever is holding
 * a stale token whether it was ever real.
 */
export type ResetPasswordFailure = 'invalid_token' | 'weak_password';

export type PasswordHasher = {
  hash(plaintext: string): Promise<string>;
};

export type ResetPasswordDeps = {
  readonly resets: {
    findByTokenHash(tokenHash: string): Promise<{ readonly userId: string } | null>;
    /** `false` when the token was already spent or has expired. Atomic. */
    markUsed(tokenHash: string, at: number): Promise<boolean>;
    invalidateAllForUser(userId: string, at: number): Promise<number>;
  };
  /**
   * The repository has a failure vocabulary of its own; all this needs to know
   * is whether the row was still there.
   */
  readonly users: {
    setPasswordHash(id: string, passwordHash: string): Promise<Result<void, string>>;
  };
  readonly sessions: { deleteAllForUser(userId: string): Promise<number> };
  readonly passwords: PasswordHasher;
  readonly clock: Clock;
};

export type ResetPassword = (
  input: ResetPasswordInput,
) => Promise<Result<void, ResetPasswordFailure>>;

export function makeResetPassword(deps: ResetPasswordDeps): ResetPassword {
  return async (input) => {
    // Checked before the token is spent: a password the rules refuse would
    // otherwise burn the one use the link had and send the person back to
    // their mail for a new one.
    if (!isValidPassword(input.newPassword)) return err('weak_password');

    const tokenHash = await sha256Hex(input.token);
    const reset = await deps.resets.findByTokenHash(tokenHash);
    if (reset === null) return err('invalid_token');

    const now = deps.clock.nowSeconds();
    // Expiry and single use are both enforced by this write, not by the read
    // above — the read only tells us whose account to touch.
    if (!(await deps.resets.markUsed(tokenHash, now))) return err('invalid_token');

    const passwordHash = await deps.passwords.hash(input.newPassword);
    const written = await deps.users.setPasswordHash(reset.userId, passwordHash);
    // A token cannot outlive its user — deleting one deletes its tokens in the
    // same batch — so this is a row that vanished mid-reset. The link is dead
    // either way, and that is what the person needs to be told.
    if (!written.ok) return err('invalid_token');

    // The token just spent is already marked; this is for any other link the
    // same person asked for before this one landed.
    await deps.resets.invalidateAllForUser(reset.userId, now);

    const closed = await deps.sessions.deleteAllForUser(reset.userId);
    logger.info('password_reset_completed', { userId: reset.userId, sessionsClosed: closed });

    return ok(undefined);
  };
}
