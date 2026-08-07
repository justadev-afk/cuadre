/**
 * A merchant adding a cashier to their own panel.
 *
 * **There is no `role` parameter, and that is the design.** A company's staff
 * has two roles and only two: `company` — the administrator, created together
 * with the company itself by the platform team in
 * `companies/create-company.ts` — and `cashier`. A cashier *is* the pair this
 * input carries: a username and a PIN, and no email at all, which is what the
 * schema's CHECK constraints say too. There is no supervisor tier to select,
 * so there is nothing to select.
 *
 * The username is judged exactly as it was typed, minus surrounding space. The
 * domain refuses upper case rather than folding it, because `(company_id,
 * username)` is a UNIQUE index and 'maria.r' and 'Maria.R' resolving to two
 * rows in one company is a cashier signing into somebody else's history.
 */
import { isValidPin, isValidUsername } from '../../domain/credentials.ts';
import type { Clock } from '../../shared/clock.ts';
import { hashPassword } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
import type { IdGen } from '../../shared/id.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { type Employee, type StoredUser, toEmployee } from './employee.ts';

/**
 * The repository's whole write vocabulary, declared in full because the port
 * has to accept everything the adapter can return. Most of it cannot happen on
 * this path — which is why the ones that cannot are worth an `AppError` if
 * they ever do.
 */
type UserWriteFailure =
  | 'email_taken'
  | 'username_taken'
  | 'invalid_for_role'
  | 'unknown_company'
  | 'not_found'
  | 'has_history';

/**
 * The narrow port. The input is spelled out rather than borrowed so that the
 * three columns a cashier may not have — an email, any other role, a company
 * that is not the caller's — cannot be supplied from here at all.
 */
export interface CashierRegistry {
  createUser(input: {
    readonly id: string;
    readonly companyId: string;
    readonly role: 'cashier';
    readonly name: string;
    readonly email: null;
    readonly username: string;
    readonly passwordHash: string;
    readonly createdAt: number;
  }): Promise<Result<StoredUser, UserWriteFailure>>;
}

export type CreateEmployeeInput = {
  readonly companyId: string;
  readonly name: string;
  readonly username: string;
  readonly pin: string;
};

export type CreateEmployeeFailure = 'username_taken' | 'invalid_username' | 'weak_pin';

export type CreateEmployee = (
  input: CreateEmployeeInput,
) => Promise<Result<Employee, CreateEmployeeFailure>>;

export type CreateEmployeeDeps = {
  readonly users: CashierRegistry;
  readonly clock: Clock;
  readonly idGen: IdGen;
};

export function makeCreateEmployee({ users, clock, idGen }: CreateEmployeeDeps): CreateEmployee {
  return async (input) => {
    const username = input.username.trim();
    if (!isValidUsername(username)) return err('invalid_username');

    // '1234', '0000' and their kind are refused by the domain. That matters
    // more here than the length does: the five-attempts-an-hour limit assumes
    // an attacker is guessing blind, and against an obvious PIN the first of
    // those five is enough.
    if (!isValidPin(input.pin)) return err('weak_pin');

    const created = await users.createUser({
      id: idGen.uuid(),
      companyId: input.companyId,
      role: 'cashier',
      name: input.name.trim(),
      // Never an email. A cashier's PIN is reset by their own company — see
      // `update-employee.ts` — so they need no mail channel and we carry no
      // address for them.
      email: null,
      username,
      passwordHash: await hashPassword(input.pin),
      createdAt: clock.nowSeconds(),
    });

    if (created.ok) return ok(toEmployee(created.value));
    if (created.error === 'username_taken') return err('username_taken');

    // Everything else is a wiring fault, not a decision the panel can make.
    // `unknown_company` in particular: `companyId` comes from the session of
    // somebody who just signed into that company.
    throw new AppError('internal', `cashier create returned ${created.error}`);
  };
}
