/**
 * `POST /api/sign-in/company` — the merchant's door.
 *
 * An empty field is refused here rather than by the use case: it is not a wrong
 * password, and spending a rate-limit slot on one would let a stranger burn
 * somebody's ten-an-hour without ever guessing.
 */
import { jsonResponse } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { DEVICE_ID_FIELD } from '../../../_lib/device-id.ts';
import { secretField, textField } from '../../../_lib/inputs.ts';
import { destinationAfterSignIn } from '../../../_lib/landing.ts';
import { callerIpHash } from '../../../_lib/request-context.ts';
import { signInReply } from '../../../_lib/sign-in-endpoint.ts';

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const email = textField(form, 'email');
  const password = secretField(form, 'password');
  if (email === '' || password === '') {
    return jsonResponse({ error: 'Escribe tu correo y tu contraseña.' });
  }

  const result = await container().auth.signInCompany({
    email,
    password,
    ipHash: await callerIpHash(),
    deviceId: textField(form, DEVICE_ID_FIELD),
  });

  // The `next` the middleware put on the URL, carried through the form as a
  // hidden field. `destinationAfterSignIn` decides whether to honour it.
  const next = textField(form, 'next');
  return signInReply('company', result, (signedIn) =>
    destinationAfterSignIn(signedIn.session.role, next === '' ? null : next),
  );
}
