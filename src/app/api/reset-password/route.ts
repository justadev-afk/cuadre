/**
 * `POST /api/reset-password` — set a new password from a mailed link, and walk
 * in with it.
 *
 * The one endpoint under `/api` with no session guard, and deliberately: the
 * token *is* the credential. `requireApi` here would refuse every caller this
 * route exists for — nobody arrives at a reset link signed in.
 *
 * It ends the way the sign-in endpoints do. Every session that user had is
 * closed by the use case (a stolen-then-reset account must not keep a session
 * the thief still holds) and a fresh one is opened for the browser that just
 * proved it owns the address, so the answer carries `Set-Cookie` and the
 * `redirect` the client follows with a full navigation. Asking somebody to type,
 * twice, the password they chose ten seconds ago verifies nothing.
 *
 * A reset that could not open a session — a disabled account, a suspended
 * company — still changed the password, and goes to the login door: the one
 * place that already says why, in the vocabulary it uses for every other
 * refusal.
 */
import { PASSWORD_MIN_LENGTH } from '../../../domain/credentials.ts';
import { formOf, jsonResponse, refusal } from '../../_lib/api-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { DEVICE_ID_FIELD } from '../../_lib/device-id.ts';
import { secretField, textField } from '../../_lib/inputs.ts';
import { landingFor } from '../../_lib/landing.ts';
import { callerIpHash } from '../../_lib/request-context.ts';
import { sessionReply } from '../../_lib/sign-in-endpoint.ts';

const DEAD_LINK = 'Este enlace ya no funciona. Pide uno nuevo desde “¿Olvidaste tu contraseña?”.';
const TOO_SHORT = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;

export async function POST(request: Request): Promise<Response> {
  const form = await formOf(request);
  if (form === null) return refusal('No se pudo leer el formulario.');

  const token = textField(form, 'token');
  const newPassword = secretField(form, 'password');
  const confirm = secretField(form, 'confirm');

  if (token === '') return refusal(DEAD_LINK);
  // The same floor the domain enforces, read off the same constant: a screen
  // that promises seven and a rule that refuses at eight is a form that can
  // only be wrong.
  if (newPassword.length < PASSWORD_MIN_LENGTH) return refusal(TOO_SHORT);
  if (newPassword !== confirm) return refusal('Las dos contraseñas no coinciden.');

  const result = await container().auth.resetPassword({
    token,
    newPassword,
    ipHash: await callerIpHash(),
    deviceId: textField(form, DEVICE_ID_FIELD),
  });
  if (!result.ok) {
    // invalid_token: expired, already used, or never real — one honest answer.
    return refusal(result.error === 'weak_password' ? TOO_SHORT : DEAD_LINK);
  }

  const signedIn = result.value;
  // The password is set either way; `null` is an account that may not be in the
  // app right now, and it leaves here with no cookie.
  if (signedIn === null) {
    return jsonResponse({ ok: true, error: null, redirect: '/login?reset=ok' });
  }

  // The same answer a sign-in gives, from the same function: cookie, and where
  // the role lands.
  return sessionReply(signedIn, landingFor(signedIn.session.role));
}
