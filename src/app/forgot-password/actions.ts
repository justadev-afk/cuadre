'use server';

/**
 * Ask for a reset link. The screen's answer is the same whether or not the
 * address is registered — the use case guarantees that, and this action must
 * not add a branch that gives it away.
 */
import { container } from '../_lib/current-session.ts';
import { textField } from '../_lib/inputs.ts';
import { callerIpHash } from '../_lib/request-context.ts';
import type { ForgotState } from './form-state.ts';

export async function requestResetAction(
  _previous: ForgotState,
  form: FormData,
): Promise<ForgotState> {
  const email = textField(form, 'email');
  if (email === '') return { done: false, error: 'Escribe el correo de tu cuenta.' };

  // Returns void whatever the outcome — the mail (if any) is enqueued, never
  // sent inline, so the screen never waits on SMTP and never learns the result.
  await container().auth.requestPasswordReset({ email, ipHash: await callerIpHash() });

  return { done: true, error: null };
}
