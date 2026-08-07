/**
 * Screen 04 — recover access. A merchant gets a reset link by mail; a cashier
 * does not, and the card says so: their PIN is reset by their company, which is
 * one fewer channel to attack.
 */
import Link from 'next/link';

import { AuthShell } from '../_components/auth-shell.tsx';
import { Icon } from '../_components/icon.tsx';
import { ForgotForm } from './forgot-form.tsx';

export const metadata = { title: 'Recuperar acceso · Cuadre' };

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <Link
        href="/login"
        style={{
          fontSize: 13,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 'auto',
        }}
      >
        <Icon name="arrow-left" />
        Volver
      </Link>

      <h3 style={{ margin: '0 0 6px' }}>Recuperar acceso</h3>
      <p className="text-muted" style={{ fontSize: 13, marginBottom: 18 }}>
        Te enviamos un enlace para crear una contraseña nueva.
      </p>

      <ForgotForm />

      <div className="card elev-sm" style={{ marginTop: 24, gap: 6 }}>
        <div className="card-kicker">Cajeros</div>
        <p className="card-body" style={{ margin: 0 }}>
          El PIN de caja lo restablece tu empresa desde su panel de empleados.
        </p>
      </div>

      <p className="text-muted" style={{ fontSize: 12, marginTop: 'auto' }}>
        Soporte · soporte@cuadre.ve
      </p>
    </AuthShell>
  );
}
