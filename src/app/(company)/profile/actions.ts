'use server';

/**
 * The company user changes their own password. Both ids come from the session,
 * never the form — the use case checks they agree, so a route wired to the
 * wrong id cannot cross a merchant boundary. On success every session is
 * closed, including this one, so the redirect lands on the login screen.
 */
import { redirect } from 'next/navigation';

import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { secretField } from '../../_lib/inputs.ts';
import type { ChangePasswordState } from './form-state.ts';

export async function changePasswordAction(
  _previous: ChangePasswordState,
  form: FormData,
): Promise<ChangePasswordState> {
  const { resolved, companyId } = await requireCompany();

  const currentPassword = secretField(form, 'current');
  const newPassword = secretField(form, 'next');
  if (currentPassword === '' || newPassword === '') {
    return { error: 'Escribe tu contraseña actual y la nueva.' };
  }
  if (newPassword.length < 8) {
    return { error: 'La nueva contraseña debe tener al menos 8 caracteres.' };
  }

  const result = await container().employees.changeOwnPassword({
    companyId,
    userId: resolved.session.userId,
    currentPassword,
    newPassword,
  });

  if (!result.ok) {
    if (result.error === 'wrong_password') return { error: 'La contraseña actual no es correcta.' };
    if (result.error === 'weak_password')
      return { error: 'Elige una contraseña de al menos 8 caracteres.' };
    return { error: 'No se pudo cambiar la contraseña.' };
  }

  // Every session was just revoked, this one included. Send them back to sign
  // in with the new password.
  redirect('/login?reset=ok');
}
