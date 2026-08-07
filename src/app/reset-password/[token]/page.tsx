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
      <h3 className="m-0 mb-1.5 font-heading text-[25px] font-medium">Crea una contraseña nueva</h3>
      <p className="mb-[18px] text-[13px] text-muted-foreground">
        Escríbela dos veces. Al guardarla, cerramos cualquier sesión abierta de tu cuenta.
      </p>

      <ResetForm token={token} />
    </AuthShell>
  );
}
