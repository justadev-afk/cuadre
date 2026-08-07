/**
 * The company user changing their own password, from their profile screen.
 *
 * Two reads, and the second one is not redundant. `findById` deliberately does
 * not carry the password hash — the repository only puts it on a row when it
 * is asked for by a different name, so that no serialiser can put it in a
 * response by accident — and verifying the current password needs it. So this
 * establishes *who* the row is first, and then reads it again through the one
 * lookup that carries the secret. Two reads on a password change is a fair
 * price for a `findById` that can never leak one.
 *
 * **Every session ends, including the caller's own.** In this product a
 * session has no expiry of its own (`src/adapters/kv/session.store.ts`): a
 * device left signed in stays signed in until something ends it. A password
 * changed because the old one leaked, with the sessions it opened still alive,
 * has changed nothing. The port has no "all but this one", so the count comes
 * back instead and the route clears its cookie and sends the user to `/login`.
 *
 * A cashier never reaches this. They have no email and no password screen;
 * their PIN is reset by their own company in `update-employee.ts`.
 */
import { isValidPassword } from '../../domain/credentials.ts';
import { hashPassword, verifyPassword } from '../../shared/crypto.ts';
import { AppError, forbidden } from '../../shared/errors.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { isCashier, type StoredUser } from './employee.ts';

type UserWriteFailure =
  | 'email_taken'
  | 'username_taken'
  | 'invalid_for_role'
  | 'unknown_company'
  | 'not_found'
  | 'has_history';

/** A row read through the one lookup that carries the hash. */
export type StoredUserWithSecret = StoredUser & { readonly passwordHash: string };

export interface OwnCredentialStore {
  findById(id: string): Promise<StoredUser | null>;
  findByEmail(email: string): Promise<StoredUserWithSecret | null>;
  setPasswordHash(id: string, passwordHash: string): Promise<Result<void, UserWriteFailure>>;
}

export interface SessionRevoker {
  deleteAllForUser(userId: string): Promise<number>;
}

export type ChangeOwnPasswordInput = {
  /**
   * Both of these come from the session, never from the form. Checking that
   * they agree costs one comparison and means a route wired to the wrong id
   * cannot cross a merchant boundary.
   */
  readonly companyId: string;
  readonly userId: string;
  readonly currentPassword: string;
  readonly newPassword: string;
};

export type ChangeOwnPasswordFailure = 'not_found' | 'wrong_password' | 'weak_password';

/** How many devices were signed out. At least one: the caller's own. */
export type PasswordChanged = { readonly sessionsEnded: number };

export type ChangeOwnPassword = (
  input: ChangeOwnPasswordInput,
) => Promise<Result<PasswordChanged, ChangeOwnPasswordFailure>>;

export type ChangeOwnPasswordDeps = {
  readonly users: OwnCredentialStore;
  readonly sessions: SessionRevoker;
};

export function makeChangeOwnPassword({
  users,
  sessions,
}: ChangeOwnPasswordDeps): ChangeOwnPassword {
  return async (input) => {
    const found = await users.findById(input.userId);
    if (found === null || found.companyId !== input.companyId) return err('not_found');

    // A cashier signing in with a PIN has no email to look the hash up by, and
    // an eight-character password is not something they can type one-handed at
    // a counter. The route should never have got here.
    if (isCashier(found.role) || found.email === null) {
      throw forbidden('password change is for a company user');
    }

    // Judged before the PBKDF2 verify below, which is 100k iterations of real
    // CPU on a Worker's budget. Nothing leaks by answering in this order: the
    // caller is already signed in as this user.
    if (!isValidPassword(input.newPassword)) return err('weak_password');

    const secret = await users.findByEmail(found.email);
    if (secret === null) return err('not_found');
    // `ux_users_email` makes this impossible, which is exactly why it is worth
    // one line: the ownership check above was made against `found`, and this
    // is the row about to be written.
    if (secret.id !== found.id) {
      throw new AppError('internal', 'email lookup resolved to a different user');
    }

    if (!(await verifyPassword(input.currentPassword, secret.passwordHash))) {
      return err('wrong_password');
    }

    const written = await users.setPasswordHash(found.id, await hashPassword(input.newPassword));
    if (!written.ok) {
      if (written.error === 'not_found') return err('not_found');
      throw new AppError('internal', `password change returned ${written.error}`);
    }

    return ok({ sessionsEnded: await sessions.deleteAllForUser(found.id) });
  };
}
