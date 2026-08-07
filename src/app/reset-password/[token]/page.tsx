/**
 * `/reset-password/<token>` — where the mail link lands.
 *
 * The token is not checked here; it is checked when the form is submitted, so a
 * link that is merely *opened* (by a mail scanner following URLs, say) does not
 * spend it. The page only carries it into the form.
 */
import { AuthShell } from '../../_components/auth-shell.tsx';
import { ResetForm } from './reset-form.tsx';

export const metadata = { title: 'Nueva contraseña · Cuadre' };

export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <AuthShell>
      <h3 style={{ margin: '0 0 6px' }}>Crea una contraseña nueva</h3>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 18 }}>
        Escríbela dos veces. Al guardarla, cerramos cualquier sesión abierta de tu cuenta.
      </p>

      <ResetForm token={token} />
    </AuthShell>
  );
}
