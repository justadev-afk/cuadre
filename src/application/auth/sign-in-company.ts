/**
 * The merchant administrator's door: `/login` with an email and a password.
 *
 * The flow itself lives in `sign-in.ts` and is shared with the platform admin's
 * door. The only thing this file decides is which role is allowed through it —
 * and it is a use case of its own rather than a parameter on one, because the
 * two doors are separate URLs with separate screens, and a caller that has to
 * pass the role in is a caller that can pass the wrong one.
 */
import type { Result } from '../../shared/result.ts';
import {
  type PasswordSignInDeps,
  type PasswordSignInInput,
  type SignedIn,
  type SignInFailure,
  signInWithPassword,
} from './sign-in.ts';

export type SignInCompanyDeps = PasswordSignInDeps;
export type SignInCompanyInput = PasswordSignInInput;

export type SignInCompany = (input: SignInCompanyInput) => Promise<Result<SignedIn, SignInFailure>>;

export function makeSignInCompany(deps: SignInCompanyDeps): SignInCompany {
  return (input) => signInWithPassword(deps, 'company', input);
}
