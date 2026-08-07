'use server';

/**
 * The two doors behind screen 01/02. One use case each, no branching between
 * them — which tab was open decides which of these runs, and neither of them
 * can be reached with the other's fields.
 *
 * Both end the same way: the cookie is written and the caller is redirected.
 * Returning a state object instead would leave a signed-in session behind a
 * form that still shows the password field.
 */

import { redirect } from 'next/navigation';

import { container } from '../_lib/current-session.ts';
import { secretField, textField } from '../_lib/inputs.ts';
import { destinationAfterSignIn } from '../_lib/landing.ts';
import { callerIpHash } from '../_lib/request-context.ts';
import { setSessionCookie } from '../_lib/session-cookie.ts';
import { type SignInState, signInMessage } from '../_lib/sign-in-state.ts';

export async function signInCompanyAction(
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const email = textField(form, 'email');
  const password = secretField(form, 'password');
  // Refused here rather than by the use case: an empty field is not a wrong
  // password, and spending a rate-limit slot on one would let a stranger burn
  // somebody's ten-an-hour without ever guessing.
  if (email === '' || password === '') {
    return { error: 'Escribe tu correo y tu contraseña.' };
  }

  const result = await container().auth.signInCompany({
    email,
    password,
    ipHash: await callerIpHash(),
  });
  if (!result.ok) return { error: signInMessage('company', result.error) };

  await setSessionCookie(result.value.sessionId);
  redirect(destinationAfterSignIn(result.value.session.role, nextField(form)));
}

export async function signInCashierAction(
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const companySlug = textField(form, 'companySlug');
  const username = textField(form, 'username');
  const pin = secretField(form, 'pin');
  if (companySlug === '' || username === '' || pin === '') {
    return { error: 'Escribe el código de la empresa, tu usuario y tu PIN.' };
  }

  const result = await container().auth.signInCashier({
    companySlug,
    username,
    pin,
    ipHash: await callerIpHash(),
  });
  if (!result.ok) return { error: signInMessage('cashier', result.error) };

  await setSessionCookie(result.value.sessionId);
  redirect(destinationAfterSignIn(result.value.session.role, nextField(form)));
}

/**
 * The `next` the middleware put on the URL, carried through the form as a
 * hidden field. `destinationAfterSignIn` decides whether to honour it — all
 * this does is tell "absent" from "empty".
 */
function nextField(form: FormData): string | null {
  const value = textField(form, 'next');
  return value === '' ? null : value;
}
