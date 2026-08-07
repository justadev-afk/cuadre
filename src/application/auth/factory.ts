/**
 * Everything in `auth/`, built once.
 *
 * It takes already-constructed collaborators rather than `env`, which is the
 * whole reason it is testable: reading a binding here would mean a test of this
 * file needs a Worker around it. Turning `env` into adapters is
 * `src/container.ts`'s job, and it is the only place that does it.
 *
 * `AuthDeps` is the intersection of what each use case declared for itself, so
 * this file names no port of its own. Add a method to one use case's port and
 * the container is what stops compiling — never this.
 */
import {
  type AcknowledgeShift,
  type AcknowledgeShiftDeps,
  makeAcknowledgeShift,
} from './acknowledge-shift.ts';
import {
  makeRequestPasswordReset,
  type RequestPasswordReset,
  type RequestPasswordResetDeps,
} from './request-password-reset.ts';
import { makeResetPassword, type ResetPassword, type ResetPasswordDeps } from './reset-password.ts';
import {
  makeResolveSession,
  type ResolveSession,
  type ResolveSessionDeps,
} from './resolve-session.ts';
import { makeSignInAdmin, type SignInAdmin, type SignInAdminDeps } from './sign-in-admin.ts';
import {
  makeSignInCashier,
  type SignInCashier,
  type SignInCashierDeps,
} from './sign-in-cashier.ts';
import {
  makeSignInCompany,
  type SignInCompany,
  type SignInCompanyDeps,
} from './sign-in-company.ts';
import { makeSignOut, type SignOut, type SignOutDeps } from './sign-out.ts';

export type AuthDeps = SignInCompanyDeps &
  SignInAdminDeps &
  SignInCashierDeps &
  SignOutDeps &
  ResolveSessionDeps &
  AcknowledgeShiftDeps &
  RequestPasswordResetDeps &
  ResetPasswordDeps;

export type AuthUseCases = {
  readonly signInCompany: SignInCompany;
  readonly signInCashier: SignInCashier;
  readonly signInAdmin: SignInAdmin;
  readonly signOut: SignOut;
  readonly resolveSession: ResolveSession;
  readonly acknowledgeShift: AcknowledgeShift;
  readonly requestPasswordReset: RequestPasswordReset;
  readonly resetPassword: ResetPassword;
};

export function makeAuthUseCases(deps: AuthDeps): AuthUseCases {
  return {
    signInCompany: makeSignInCompany(deps),
    signInCashier: makeSignInCashier(deps),
    signInAdmin: makeSignInAdmin(deps),
    signOut: makeSignOut(deps),
    resolveSession: makeResolveSession(deps),
    acknowledgeShift: makeAcknowledgeShift(deps),
    requestPasswordReset: makeRequestPasswordReset(deps),
    resetPassword: makeResetPassword(deps),
  };
}
