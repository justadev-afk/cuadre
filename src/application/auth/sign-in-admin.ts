/**
 * The platform team's door. Same email and password as a merchant's, same
 * shared flow, `admin` only.
 *
 * It must be indistinguishable from `sign-in-company` for anything that is not
 * an admin: same failure vocabulary, same work done before each of them, same
 * refusal for a merchant's address typed in here. A door that answers "wrong
 * form" is a door that hands over the list of who the platform team are.
 *
 * An admin has no `company_id` — the schema forbids one — so nothing about a
 * company is read on this path.
 */
import type { Result } from '../../shared/result.ts';
import {
  type PasswordSignInDeps,
  type PasswordSignInInput,
  type SignedIn,
  type SignInFailure,
  signInWithPassword,
} from './sign-in.ts';

export type SignInAdminDeps = PasswordSignInDeps;
export type SignInAdminInput = PasswordSignInInput;

export type SignInAdmin = (input: SignInAdminInput) => Promise<Result<SignedIn, SignInFailure>>;

export function makeSignInAdmin(deps: SignInAdminDeps): SignInAdmin {
  return (input) => signInWithPassword(deps, 'admin', input);
}
