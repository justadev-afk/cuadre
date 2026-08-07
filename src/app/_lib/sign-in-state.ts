/**
 * What a sign-in form shows when the use case refuses, in Spanish.
 *
 * The three doors share a failure vocabulary on purpose — that is what makes
 * them indistinguishable to somebody probing which addresses belong to the
 * platform team — so the *copy* is the only thing that differs, and only where
 * it names the fields the person actually filled in. `invalid_credentials`
 * never says which of the two was wrong.
 *
 * Not in `shared/errors.ts` because these are `Result` failures the form
 * renders inline, not `AppError`s an HTTP layer maps to a status.
 */
import type { SignInFailure } from '../../application/auth/sign-in.ts';

/** `useActionState`'s state for all three sign-in forms. */
export type SignInState = { readonly error: string | null };

export const NO_SIGN_IN_ERROR: SignInState = { error: null };

/** Which form is asking. It changes one line of copy and nothing else. */
export type SignInDoor = 'company' | 'cashier' | 'admin';

const WRONG_CREDENTIALS: Record<SignInDoor, string> = {
  company: 'Correo o contraseña incorrectos.',
  cashier: 'Código, usuario o PIN incorrectos.',
  admin: 'Correo o contraseña incorrectos.',
};

const DISABLED: Record<SignInDoor, string> = {
  company: 'Tu usuario está inactivo. Escribe a soporte@cuadre.ve.',
  cashier: 'Tu usuario está inactivo. Pídele a tu empresa que lo reactive.',
  admin: 'Tu usuario está inactivo.',
};

export function signInMessage(door: SignInDoor, failure: SignInFailure): string {
  switch (failure) {
    case 'invalid_credentials':
      return WRONG_CREDENTIALS[door];
    case 'rate_limited':
      return 'Demasiados intentos. Espera un momento y vuelve a intentar.';
    case 'account_disabled':
      return DISABLED[door];
    case 'company_suspended':
      return 'La cuenta de tu empresa está suspendida. Escribe a soporte@cuadre.ve.';
  }
}
