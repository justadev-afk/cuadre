'use server';

/**
 * The platform team's door.
 *
 * It must be indistinguishable from the merchant's for anything that is not an
 * admin — same fields, same failure vocabulary, same copy for a refusal. The
 * use case guarantees the timing; this file guarantees the wording.
 */

import { redirect } from 'next/navigation';

import { container } from '../../_lib/current-session.ts';
import { DEVICE_ID_FIELD } from '../../_lib/device-id.ts';
import { secretField, textField } from '../../_lib/inputs.ts';
import { landingFor } from '../../_lib/landing.ts';
import { callerIpHash } from '../../_lib/request-context.ts';
import { setSessionCookie } from '../../_lib/session-cookie.ts';
import { type SignInState, signInMessage } from '../../_lib/sign-in-state.ts';

export async function signInAdminAction(
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const email = textField(form, 'email');
  const password = secretField(form, 'password');
  if (email === '' || password === '') {
    return { error: 'Escribe tu correo y tu contraseña.' };
  }

  const result = await container().auth.signInAdmin({
    email,
    password,
    ipHash: await callerIpHash(),
    deviceId: textField(form, DEVICE_ID_FIELD),
  });
  if (!result.ok) return { error: signInMessage('admin', result.error) };

  await setSessionCookie(result.value.sessionId);
  // No `next` here. This route is unlinked and the admin area has one entrance,
  // so there is nowhere to have been bounced off on the way in.
  redirect(landingFor(result.value.session.role));
}
