/**
 * `POST /api/sign-in/admin` — the platform team's door.
 *
 * It must be indistinguishable from the merchant's for anything that is not an
 * admin: same fields, same failure vocabulary, same copy for a refusal. The use
 * case guarantees the timing; the shared reply guarantees the wording.
 *
 * No `next` here. This route is unlinked and the admin area has one entrance, so
 * there is nowhere to have been bounced off on the way in.
 */
import { jsonResponse } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { DEVICE_ID_FIELD } from '../../../_lib/device-id.ts';
import { secretField, textField } from '../../../_lib/inputs.ts';
import { landingFor } from '../../../_lib/landing.ts';
import { callerIpHash } from '../../../_lib/request-context.ts';
import { signInReply } from '../../../_lib/sign-in-endpoint.ts';

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const email = textField(form, 'email');
  const password = secretField(form, 'password');
  if (email === '' || password === '') {
    return jsonResponse({ error: 'Escribe tu correo y tu contraseña.' });
  }

  const result = await container().auth.signInAdmin({
    email,
    password,
    ipHash: await callerIpHash(),
    deviceId: textField(form, DEVICE_ID_FIELD),
  });

  return signInReply('admin', result, (signedIn) => landingFor(signedIn.session.role));
}
