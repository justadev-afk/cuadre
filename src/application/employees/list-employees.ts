/**
 * The people a merchant has on their panel: the company's own administrators
 * and its cashiers, with when each of them last signed in.
 *
 * The list is scoped by `company_id` and by nothing else. That is the boundary
 * between merchants, and it is not a filter this file lays on top of a wider
 * read — `listByCompany` is the only call on the port, and its first argument
 * is the scope.
 *
 * Disabled people stay on the list. A company that cannot see the cashier it
 * disabled last week has no way to tell that seat apart from one that was
 * never created, and that row is also where "esta persona ya no entra" is
 * read.
 *
 * **The order is administrators first, then cashiers, each alphabetically.** A
 * shop has one or two people who run the panel and as many tills as it has
 * counters, so a list sorted by name alone buries the two accounts that can do
 * anything among "Caja 1, Caja 2, Caja 3". It is decided here rather than in the
 * screen because the merchant's panel and the admin's company page both show
 * this list, and two sorts that drift are two different answers to "who is on
 * this account".
 */
import { type Employee, type StoredUser, toEmployee } from './employee.ts';

/**
 * Administrators before cashiers. Read off the *projected* role, so a row
 * carrying a role this build cannot read sorts with the cashiers — the same
 * direction `toEmployeeRole` already folds it for every other purpose.
 */
const ROLE_ORDER: Record<Employee['role'], number> = { company: 0, cashier: 1 };

/** The narrow port. One call, and its first argument is the boundary. */
export interface CompanyUserDirectory {
  listByCompany(companyId: string): Promise<readonly StoredUser[]>;
}

export type ListEmployeesInput = { readonly companyId: string };

export type ListEmployees = (input: ListEmployeesInput) => Promise<readonly Employee[]>;

export type ListEmployeesDeps = { readonly users: CompanyUserDirectory };

export function makeListEmployees({ users }: ListEmployeesDeps): ListEmployees {
  return async ({ companyId }) => {
    const rows = await users.listByCompany(companyId);
    return rows
      .map(toEmployee)
      .sort(
        (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name, 'es'),
      );
  };
}
