/**
 * Screen 04 — recover access. A merchant gets a reset link by mail; a cashier
 * does not, and the card says so: their PIN is reset by their company, which is
 * one fewer channel to attack.
 */
import Link from 'next/link';

import { AuthShell } from '../_components/auth-shell.tsx';
import { Icon } from '../_components/icon.tsx';
import { pageMeta } from '../_lib/page-meta.ts';
import { ForgotForm } from './forgot-form.tsx';

export const metadata = pageMeta('Recuperar acceso');

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <Link href="/login" className="mb-auto inline-flex items-center gap-1.5 text-[13px]">
        <Icon name="arrow-left" />
        Volver
      </Link>

      <h3 className="m-0 mb-1.5 font-heading text-[25px] font-medium">Recuperar acceso</h3>
      <p className="mb-[18px] text-[13px] text-muted-foreground">
        Te enviamos un enlace para crear una contraseña nueva.
      </p>

      <ForgotForm />

      <div className="mt-6 flex flex-col gap-1.5 rounded-md bg-card p-3.5 shadow-[var(--shadow-sm)]">
        <div className="text-[10px] tracking-[0.1em] text-primary uppercase">Cajeros</div>
        <p className="m-0 text-[13px] opacity-80">
          El PIN de caja lo restablece tu empresa desde su panel de empleados.
        </p>
      </div>

      <p className="mt-auto text-xs text-muted-foreground">Soporte · soporte@cuadre.ve</p>
    </AuthShell>
  );
}
