/**
 * A merchant editing one of their own people: their name, whether they still
 * have access, and — the reason this screen exists — their PIN.
 *
 * **A new PIN here is the only reset channel a cashier has.** They carry no
 * email, on purpose, so there is no link to send them: when a cashier forgets
 * their PIN on a Monday morning, the person who fixes it is standing in the
 * same shop.
 *
 * The company boundary is enforced *here*, not by the statement. `users.id` is
 * a uuid and globally unique, so the repository's `updateProfile`,
 * `setPasswordHash` and `disable` are all keyed by it alone and carry no
 * `company_id` in their WHERE. That makes this read the boundary: without it,
 * a merchant who guessed a uuid could rename — or re-PIN — another merchant's
 * cashier. Nothing is written before it has answered.
 *
 * **`status` is the whole of hiring and firing here, and it goes both ways.**
 * Nothing deletes a user: `validations.cashier_id` names whoever confirmed each
 * payment and has to keep naming them, so taking access away is a column and
 * giving it back is the same column. A shop that disables the wrong cashier on
 * a Saturday fixes it in the same dialog, which is why the port takes a status
 * rather than exposing a one-way `disable`.
 */
import { isValidPin } from '../../domain/credentials.ts';
import { hashPassword } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import {
  type Employee,
  type EmployeeRole,
  type EmployeeStatus,
  isCashier,
  type StoredUser,
  toEmployee,
  wouldLeaveNoAdministrator,
} from './employee.ts';

type UserWriteFailure =
  | 'email_taken'
  | 'username_taken'
  | 'invalid_for_role'
  | 'unknown_company'
  | 'not_found';

/**
 * The narrow port. `updateProfile` is declared with a patch that has only
 * `name` in it although the repository's has three fields: a cashier's
 * username is half of their login tuple and an email belongs to a role this
 * screen does not create, so neither is editable from here — and now cannot be
 * passed from here either.
 */
export interface CompanyUserWriter {
  findById(id: string): Promise<StoredUser | null>;
  listByCompany(companyId: string, role?: EmployeeRole): Promise<readonly StoredUser[]>;
  updateProfile(
    id: string,
    patch: { readonly name?: string },
  ): Promise<Result<StoredUser, UserWriteFailure>>;
  setPasswordHash(id: string, passwordHash: string): Promise<Result<void, UserWriteFailure>>;
  setStatus(id: string, status: EmployeeStatus): Promise<Result<StoredUser, UserWriteFailure>>;
}

/** Sessions never expire on their own, so something has to end them. */
export interface SessionRevoker {
  /** Every device this user is signed in on. Returns how many were ended. */
  deleteAllForUser(userId: string): Promise<number>;
}

export type UpdateEmployeeInput = {
  readonly companyId: string;
  readonly userId: string;
  readonly name?: string;
  /** Access, in both directions. See the note at the top of the file. */
  readonly status?: EmployeeStatus;
  /** A new PIN for a cashier. Replaces the old one immediately. */
  readonly pin?: string;
};

export type UpdateEmployeeFailure =
  | 'not_found'
  | 'weak_pin'
  | 'not_a_cashier'
  | 'last_administrator';

export type UpdateEmployee = (
  input: UpdateEmployeeInput,
) => Promise<Result<Employee, UpdateEmployeeFailure>>;

export type UpdateEmployeeDeps = {
  readonly users: CompanyUserWriter;
  readonly sessions: SessionRevoker;
};

export function makeUpdateEmployee({ users, sessions }: UpdateEmployeeDeps): UpdateEmployee {
  return async (input) => {
    const found = await users.findById(input.userId);
    // A user of another company answers exactly as a user who does not exist.
    // Telling a merchant "that person is real, just not yours" confirms an id
    // they had no business holding.
    if (found === null || found.companyId !== input.companyId) return err('not_found');

    if (input.pin !== undefined) {
      // A `company` user signs in with an email and a password. Writing four
      // digits into their `password_hash` would install a password that
      // `isValidPassword` would have refused, through a field named after a
      // credential they do not use.
      if (!isCashier(found.role)) return err('not_a_cashier');
      if (!isValidPin(input.pin)) return err('weak_pin');
    }

    // Only *removing* access can leave a company locked out of itself. Handing
    // it back never can, so it is not asked about.
    if (input.status === 'disabled' && !isCashier(found.role)) {
      const administrators = await users.listByCompany(input.companyId, 'company');
      if (wouldLeaveNoAdministrator(administrators, found.id)) return err('last_administrator');
    }

    // Everything above refuses without writing, so a rejected PIN cannot leave
    // a half-applied rename behind it.
    let current = found;

    if (input.name !== undefined) {
      const renamed = await users.updateProfile(found.id, { name: input.name.trim() });
      if (!renamed.ok) return failed(renamed.error, 'rename');
      current = renamed.value;
    }

    if (input.pin !== undefined) {
      const reset = await users.setPasswordHash(found.id, await hashPassword(input.pin));
      if (!reset.ok) return failed(reset.error, 'pin reset');
      // The old PIN must not survive as a live session. In this product that
      // is not a formality: a session has no expiry of its own, so a phone
      // left signed in stays signed in until something ends it, and a PIN is
      // reset precisely when the old one can no longer be trusted.
      await sessions.deleteAllForUser(found.id);
    }

    if (input.status !== undefined && input.status !== found.status) {
      const written = await users.setStatus(found.id, input.status);
      if (!written.ok) return failed(written.error, `status ${input.status}`);
      current = written.value;

      // Disabling stops the *next* sign-in and nothing else, so the live tabs
      // are ended here too: somebody being walked off the floor is exactly the
      // case where the till already open is the one that matters. It is a
      // best-effort sweep of a KV index — `resolveSession` re-reads the status
      // column on every request, which is what actually closes the door.
      if (input.status === 'disabled') await sessions.deleteAllForUser(found.id);
    }

    return ok(toEmployee(current));
  };
}

/**
 * Only `not_found` is reachable, and only as a race: the row was read a moment
 * ago and something deleted it in between. The rest are unique indexes and
 * CHECK constraints that no field of this input can reach.
 */
function failed(failure: UserWriteFailure, step: string): Result<never, UpdateEmployeeFailure> {
  if (failure === 'not_found') return err('not_found');
  throw new AppError('internal', `employee ${step} returned ${failure}`);
}
