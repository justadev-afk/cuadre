/**
 * Taking somebody's access away, immediately — and keeping every payment they
 * ever confirmed.
 *
 * **The two are not in tension, and the schema is what settles it.**
 * `validations.cashier_id` is a foreign key with no `ON DELETE` clause, so
 * SQLite simply refuses to delete a cashier who has confirmed a payment and
 * the repository reports `has_history`. That refusal is the feature: a
 * validated payment is an accounting fact, and the row has to keep naming the
 * person who took the money years after they left. **The repository must not
 * cascade** — a cascade here would delete the history to make the delete
 * succeed, which is the wrong half of the trade.
 *
 * So this reads as one action with two honest endings. A cashier who never
 * confirmed anything — a mistyped invitation — is deleted outright. A cashier
 * with history is disabled, which is the same thing from where they are
 * standing: they cannot sign in again.
 *
 * The sessions go first. Ending them and then failing to write leaves somebody
 * signed out who still exists, which the merchant can simply retry; writing
 * first and then failing to end them leaves somebody deleted who is still
 * holding a live till.
 */
import { AppError } from '../../shared/errors.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import {
  type EmployeeRole,
  isCashier,
  type StoredUser,
  wouldLeaveNoAdministrator,
} from './employee.ts';

type UserWriteFailure =
  | 'email_taken'
  | 'username_taken'
  | 'invalid_for_role'
  | 'unknown_company'
  | 'not_found'
  | 'has_history';

export interface CompanyUserRemover {
  findById(id: string): Promise<StoredUser | null>;
  listByCompany(companyId: string, role?: EmployeeRole): Promise<readonly StoredUser[]>;
  /** A hard delete. `has_history` when a validation still points at them. */
  remove(id: string): Promise<Result<void, UserWriteFailure>>;
  disable(id: string): Promise<Result<StoredUser, UserWriteFailure>>;
}

export interface SessionRevoker {
  deleteAllForUser(userId: string): Promise<number>;
}

export type DeleteEmployeeInput = {
  readonly companyId: string;
  readonly userId: string;
};

/**
 * Which ending it was. The panel says different things — *se eliminó* against
 * *se desactivó, sus validaciones se conservan* — and the merchant deserves to
 * know that the history is still there.
 */
export type DeleteEmployeeOutcome = { readonly outcome: 'deleted' | 'disabled' };

export type DeleteEmployeeFailure = 'not_found' | 'last_administrator';

export type DeleteEmployee = (
  input: DeleteEmployeeInput,
) => Promise<Result<DeleteEmployeeOutcome, DeleteEmployeeFailure>>;

export type DeleteEmployeeDeps = {
  readonly users: CompanyUserRemover;
  readonly sessions: SessionRevoker;
};

export function makeDeleteEmployee({ users, sessions }: DeleteEmployeeDeps): DeleteEmployee {
  return async ({ companyId, userId }) => {
    const found = await users.findById(userId);
    // The company boundary. `remove` and `disable` are keyed by the uuid alone,
    // so this read is the only thing standing between a guessed id and another
    // merchant's staff — and a user who is not yours reads as one who is not
    // there.
    if (found === null || found.companyId !== companyId) return err('not_found');

    if (!isCashier(found.role)) {
      const administrators = await users.listByCompany(companyId, 'company');
      if (wouldLeaveNoAdministrator(administrators, found.id)) return err('last_administrator');
    }

    await sessions.deleteAllForUser(found.id);

    const removed = await users.remove(found.id);
    if (removed.ok) return ok({ outcome: 'deleted' });
    if (removed.error === 'not_found') return err('not_found');
    if (removed.error !== 'has_history') {
      throw new AppError('internal', `employee delete returned ${removed.error}`);
    }

    // They confirmed payments, so the row stays and the access goes.
    const disabled = await users.disable(found.id);
    if (disabled.ok) return ok({ outcome: 'disabled' });
    if (disabled.error === 'not_found') return err('not_found');
    throw new AppError('internal', `employee disable returned ${disabled.error}`);
  };
}
