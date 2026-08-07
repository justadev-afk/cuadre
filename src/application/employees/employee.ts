/**
 * What a merchant's staff *is*, as the company area's use cases pass it
 * around: the record the panel renders, the row the repository hands back, and
 * the one mapping between them.
 *
 * It sits beside the use cases rather than inside one of them because four of
 * them speak it and none of them owns it — the same shape as
 * `src/application/session.ts`. Nothing here is a port and nothing here
 * touches a database.
 */

/**
 * **Only two roles exist for a company's staff.** A merchant has one
 * administrator and however many cashiers they employ; the tier between them
 * was dropped in migration 0002 and is not coming back through this file. The
 * third role in the schema, `admin`, is the platform team and has no
 * `company_id`, so it can never appear in a company-scoped list.
 */
export type EmployeeRole = 'company' | 'cashier';

export type EmployeeStatus = 'active' | 'disabled';

export type Employee = {
  readonly id: string;
  readonly role: EmployeeRole;
  readonly name: string;
  /** Set for a `company` user. A cashier has none, by CHECK constraint. */
  readonly email: string | null;
  /** Set for a cashier: half of the `(company_id, username)` login tuple. */
  readonly username: string | null;
  readonly status: EmployeeStatus;
  /** Last access. `null` for somebody who has never signed in. */
  readonly lastLoginAt: number | null;
  readonly createdAt: number;
};

/**
 * A row as a repository hands it back, before this build has agreed that it
 * understands it.
 *
 * `role` is a plain string on purpose, exactly as a stored session's is: the
 * column has held values this build does not act on, and one it cannot read
 * has to fail closed rather than be trusted into a screen. The password hash
 * is deliberately absent — the repository only puts it on the row when it is
 * asked for by a different name.
 */
export type StoredUser = {
  readonly id: string;
  readonly companyId: string | null;
  readonly role: string;
  readonly name: string;
  readonly email: string | null;
  readonly username: string | null;
  readonly status: EmployeeStatus;
  readonly lastLoginAt: number | null;
  readonly createdAt: number;
};

/**
 * The projection the panel receives. It drops `companyId`, so a component that
 * spread an employee straight into a response cannot hand one merchant's slug
 * to another's screen.
 */
export function toEmployee(row: StoredUser): Employee {
  return {
    id: row.id,
    role: toEmployeeRole(row.role),
    name: row.name,
    email: row.email,
    username: row.username,
    status: row.status,
    lastLoginAt: row.lastLoginAt,
    createdAt: row.createdAt,
  };
}

/** Fails to the least privilege: an unreadable role is never the administrator. */
export function toEmployeeRole(role: string): EmployeeRole {
  return role === 'company' ? 'company' : 'cashier';
}

/**
 * Whether this row is a cashier, judged on the stored string rather than
 * through `toEmployeeRole`.
 *
 * The two disagree on purpose. `toEmployeeRole` folds a role it cannot read
 * *down* to `cashier`, which is the least privilege on a screen — but a
 * cashier is the one role that holds a PIN and the one whose deletion needs no
 * second thought, so a decision like that has to make the unreadable role fall
 * the other way.
 */
export function isCashier(role: string): boolean {
  return role === 'cashier';
}

/**
 * Would revoking this person's access leave the company with nobody who can
 * sign into its panel?
 *
 * A merchant who disables or deletes their own last administrator is locked
 * out of their own account, and there is no self-service way back: the reset
 * mail goes to an address on a user row that can no longer sign in, and the
 * cashiers cannot reach the panel at all. It is a support call, and the whole
 * of it is preventable by counting first.
 *
 * Only an *active* administrator counts, because a disabled one cannot sign in
 * either — so the disabled row is not a way back and must not read as one.
 */
export function wouldLeaveNoAdministrator(
  companyUsers: readonly StoredUser[],
  leavingId: string,
): boolean {
  return !companyUsers.some(
    (row) =>
      row.id !== leavingId && row.status === 'active' && toEmployeeRole(row.role) === 'company',
  );
}
