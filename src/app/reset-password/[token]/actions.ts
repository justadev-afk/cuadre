'use server';

/**
 * Set a new password from a reset link. On success every session of that user
 * is closed (the use case does it), so a stolen-then-reset account cannot keep
 * a session the thief still holds.
 *
 * The token rides through the form as a hidden field rather than being bound
 * into a closure — a Server Action has to be an exported function, and reading
 * it off `FormData` keeps this one plain.
 */
import { redirect } from 'next/navigation';

import { container } from '../../_lib/current-session.ts';
import { secretField, textField } from '../../_lib/inputs.ts';
import type { ResetState } from './form-state.ts';

export async function resetPasswordAction(
  _previous: ResetState,
  form: FormData,
): Promise<ResetState> {
  const token = textField(form, 'token');
  const newPassword = secretField(form, 'password');
  const confirm = secretField(form, 'confirm');

  if (token === '') {
    return {
      error: 'Este enlace ya no funciona. Pide uno nuevo desde “¿Olvidaste tu contraseña?”.',
    };
  }
  if (newPassword.length < 8) {
    return { error: 'La contraseña debe tener al menos 8 caracteres.' };
  }
  if (newPassword !== confirm) {
    return { error: 'Las dos contraseñas no coinciden.' };
  }

  const result = await container().auth.resetPassword({ token, newPassword });
  if (!result.ok) {
    if (result.error === 'weak_password') {
      return { error: 'Elige una contraseña de al menos 8 caracteres.' };
    }
    // invalid_token: expired, already used, or never real — one honest answer.
    return {
      error: 'Este enlace ya no funciona. Pide uno nuevo desde “¿Olvidaste tu contraseña?”.',
    };
  }

  redirect('/login?reset=ok');
}
