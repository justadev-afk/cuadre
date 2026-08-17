/**
 * `POST /api/profile/password` — a company user changes their own password.
 *
 * Both ids come from the session, never the form; the use case checks they agree,
 * so a handler wired to the wrong id cannot cross a merchant boundary. On success
 * every session is closed, **this one included**, so the reply sends the browser
 * to the login screen rather than to a panel it can no longer load.
 */
import { PASSWORD_MIN_LENGTH } from '../../../../domain/credentials.ts';
import { jsonResponse, requireApiCompany } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { secretField } from '../../../_lib/inputs.ts';

const TOO_SHORT = `La nueva contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;

export async function POST(request: Request): Promise<Response> {
  const guard = await requireApiCompany();
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const currentPassword = secretField(form, 'current');
  const newPassword = secretField(form, 'next');
  if (currentPassword === '' || newPassword === '') {
    return jsonResponse({ error: 'Escribe tu contraseña actual y la nueva.' });
  }
  if (newPassword.length < PASSWORD_MIN_LENGTH) return jsonResponse({ error: TOO_SHORT });

  const result = await container().employees.changeOwnPassword({
    companyId: guard.companyId,
    userId: guard.resolved.session.userId,
    currentPassword,
    newPassword,
  });

  if (!result.ok) {
    if (result.error === 'wrong_password') {
      return jsonResponse({ error: 'La contraseña actual no es correcta.' });
    }
    if (result.error === 'weak_password') return jsonResponse({ error: TOO_SHORT });
    return jsonResponse({ error: 'No se pudo cambiar la contraseña.' });
  }

  // Every session was just revoked, this one included. Send them back to sign
  // in with the new password.
  return jsonResponse({ error: null, redirect: '/login?reset=ok' });
}
