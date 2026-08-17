/**
 * `POST /api/forgot-password` — ask for a reset link.
 *
 * The answer is the same whether or not the address is registered. The use case
 * guarantees that, and this handler must not add a branch that gives it away:
 * the mail is enqueued rather than sent inline, so the screen never waits on
 * SMTP and never learns the result.
 */
import { jsonResponse } from '../../_lib/api-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { textField } from '../../_lib/inputs.ts';
import { callerIpHash } from '../../_lib/request-context.ts';

export async function POST(request: Request): Promise<Response> {
  const form = await request.formData();
  const email = textField(form, 'email');
  if (email === '') return jsonResponse({ done: false, error: 'Escribe el correo de tu cuenta.' });

  await container().auth.requestPasswordReset({ email, ipHash: await callerIpHash() });

  return jsonResponse({ done: true, error: null });
}
