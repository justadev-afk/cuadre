/**
 * `POST /api/sign-in/cashier` — the till's door.
 *
 * The tuple typed on the screen is `(código de empresa, usuario, PIN)`, which is
 * literally `(company_id, username)` plus the secret. Same refusal vocabulary as
 * every other door: which of the three was wrong is never said.
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
  const companySlug = textField(form, 'companySlug');
  const username = textField(form, 'username');
  const pin = secretField(form, 'pin');
  if (companySlug === '' || username === '' || pin === '') {
    return jsonResponse({ error: 'Escribe el código de la empresa, tu usuario y tu PIN.' });
  }

  const result = await container().auth.signInCashier({
    companySlug,
    username,
    pin,
    ipHash: await callerIpHash(),
    deviceId: textField(form, DEVICE_ID_FIELD),
  });

  const next = textField(form, 'next');
  return signInReply('cashier', result, (signedIn) =>
    destinationAfterSignIn(signedIn.session.role, next === '' ? null : next),
  );
}
