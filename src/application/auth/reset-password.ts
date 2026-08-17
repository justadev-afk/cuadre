/**
 * Spending a reset link: the token from the URL becomes a new password, and the
 * person is signed in with it.
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
 * Every session that user has anywhere is closed first, and only then is a new
 * one opened. A password is usually reset because somebody else might have had
 * the old one, and leaving the tab they were already signed in on alive answers
 * the wrong half of that — while sending the person who just proved they own
 * the address back to a login form to type the password they typed twenty
 * seconds ago answers nothing at all. The order is the whole trick: closing
 * after opening would delete the session it just minted.
 */
import { isValidPassword } from '../../domain/credentials.ts';
import type { Clock } from '../../shared/clock.ts';
import { sha256Hex } from '../../shared/crypto.ts';
import type { IdGen } from '../../shared/id.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import {
  type ActiveSessionWriter,
  type CompanyStatusReader,
  isPasswordRole,
  type LastLoginWriter,
  openSession,
  refuseSuspendedCompany,
  type SessionSubject,
  type SessionWriter,
  type SignedIn,
} from './sign-in.ts';

export type ResetPasswordInput = {
  /** As it came out of the link. Hashed here, compared as a hash, never stored. */
  readonly token: string;
  readonly newPassword: string;
  /** `hashIp()` output, stamped onto the session. The use case never sees an address. */
  readonly ipHash: string;
  /** The persistent browser id, as a sign-in sends it. Empty is tolerated. */
  readonly deviceId: string;
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

/** The row behind a token, as this use case needs to read it back. */
export type ResettingUser = SessionSubject & {
  readonly role: string;
  readonly status: string;
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
    findById(id: string): Promise<ResettingUser | null>;
  } & LastLoginWriter;
  readonly companies: CompanyStatusReader;
  readonly sessions: { deleteAllForUser(userId: string): Promise<number> } & SessionWriter;
  readonly activeSessions: ActiveSessionWriter;
  readonly passwords: PasswordHasher;
  readonly clock: Clock;
  readonly ids: IdGen;
};

/**
 * The password is set either way. `null` means it was set for somebody who may
 * not open a session right now — a disabled account, a suspended company, a
 * role this build does not know — so the screen sends them to the login door,
 * which is the one place that says why in the vocabulary it already has.
 */
export type ResetPassword = (
  input: ResetPasswordInput,
) => Promise<Result<SignedIn | null, ResetPasswordFailure>>;

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

    return ok(await signInAfterReset(deps, reset.userId, input));
  };
}

/**
 * The session the reset hands over, or `null` when this account may not have
 * one.
 *
 * The checks are the sign-in's own — status, and the company behind it — read
 * through the same ports, because "may this account be in the app right now" is
 * one question and a second spelling of it is a door that disagrees with the
 * other three. What it deliberately does not repeat is the password: the token
 * was the proof, and it has just been spent.
 */
async function signInAfterReset(
  deps: ResetPasswordDeps,
  userId: string,
  input: ResetPasswordInput,
): Promise<SignedIn | null> {
  const user = await deps.users.findById(userId);
  // The row was there a moment ago (`setPasswordHash` wrote to it), so this is
  // a user deleted mid-reset. The password change stands; the session does not.
  if (user === null) return null;

  // A cashier signs in with a PIN their company resets, never with a mailed
  // link, so a role that is not one of the two email-holding ones is a row this
  // path should never have reached.
  if (!isPasswordRole(user.role)) {
    logger.warn('password_reset_no_session', { userId, reason: 'role' });
    return null;
  }
  if (user.status !== 'active') {
    logger.info('password_reset_no_session', { userId, reason: 'account_disabled' });
    return null;
  }

  const refusal = await refuseSuspendedCompany(deps.companies, user, user.role);
  if (refusal !== null) {
    logger.info('password_reset_no_session', { userId, reason: refusal });
    return null;
  }

  return openSession(deps, user, user.role, input.ipHash, input.deviceId);
}
