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
 */
import { type Employee, type StoredUser, toEmployee } from './employee.ts';

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
    return rows.map(toEmployee);
  };
}
