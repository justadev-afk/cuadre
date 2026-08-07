/**
 * The company area's staff use cases, built over adapters that already exist.
 *
 * Nothing is constructed here — no `env`, no `D1Database`, no KV namespace.
 * That is `src/container.ts`'s job, and keeping it there is what lets this
 * file be called with two hand-written fakes in a test.
 *
 * `EmployeeUseCaseDeps` is the intersection of what each use case declared for
 * itself rather than a sixth list written by hand. A port that gains a method
 * therefore widens this type automatically, and the compiler reports the gap
 * against the container that has to supply it.
 */
import {
  type ChangeOwnPassword,
  type ChangeOwnPasswordDeps,
  makeChangeOwnPassword,
} from './change-own-password.ts';
import {
  type CreateEmployee,
  type CreateEmployeeDeps,
  makeCreateEmployee,
} from './create-employee.ts';
import {
  type DeleteEmployee,
  type DeleteEmployeeDeps,
  makeDeleteEmployee,
} from './delete-employee.ts';
import { type ListEmployees, type ListEmployeesDeps, makeListEmployees } from './list-employees.ts';
import {
  makeUpdateEmployee,
  type UpdateEmployee,
  type UpdateEmployeeDeps,
} from './update-employee.ts';

export type EmployeeUseCaseDeps = ListEmployeesDeps &
  CreateEmployeeDeps &
  UpdateEmployeeDeps &
  DeleteEmployeeDeps &
  ChangeOwnPasswordDeps;

export type EmployeeUseCases = {
  readonly listEmployees: ListEmployees;
  readonly createEmployee: CreateEmployee;
  readonly updateEmployee: UpdateEmployee;
  readonly deleteEmployee: DeleteEmployee;
  readonly changeOwnPassword: ChangeOwnPassword;
};

export function makeEmployeeUseCases(deps: EmployeeUseCaseDeps): EmployeeUseCases {
  return {
    listEmployees: makeListEmployees(deps),
    createEmployee: makeCreateEmployee(deps),
    updateEmployee: makeUpdateEmployee(deps),
    deleteEmployee: makeDeleteEmployee(deps),
    changeOwnPassword: makeChangeOwnPassword(deps),
  };
}
