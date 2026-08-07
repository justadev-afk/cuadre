/**
 * Screen 03 — `/admin/login`, the platform team's door.
 *
 * A separate, unlinked route: nothing in the merchant product points here, and
 * the brand mark goes neutral with a shield so the team's own sign-in never
 * looks like the thing they operate. The copy says as much — the companies and
 * cashiers enter through `/login`.
 */
import { redirect } from 'next/navigation';

import { Badge } from '@/components/ui/badge.tsx';
import { AuthShell } from '../../_components/auth-shell.tsx';
import { Brand } from '../../_components/brand.tsx';
import { Icon } from '../../_components/icon.tsx';
import { currentSession } from '../../_lib/current-session.ts';
import { landingFor } from '../../_lib/landing.ts';
import { AdminLoginForm } from './admin-login-form.tsx';

export const metadata = { title: 'Administración · Cuadre' };

export default async function AdminLoginPage() {
  const resolution = await currentSession();
  if (resolution.kind === 'superseded') redirect('/session-ended');
  if (resolution.kind === 'active') redirect(landingFor(resolution.active.session.role));

  return (
    <AuthShell>
      <div className="mb-auto flex items-center gap-2.5">
        <Brand internal size={24} />
        <Badge variant="neutral" className="ml-auto">
          Interno
        </Badge>
      </div>

      <h4 className="m-0 mb-0.5 font-heading text-xl font-medium">Administración</h4>
      <p className="mb-[18px] text-xs text-muted-foreground">
        Acceso del equipo de Cuadre. Las empresas y los cajeros entran por{' '}
        <code className="font-mono text-[11px]">/login</code>.
      </p>

      <AdminLoginForm />

      <div className="mt-auto flex items-start gap-2 text-[11px] text-muted-foreground">
        <Icon name="lock-key" className="mt-0.5" />
        <span>Ruta no enlazada. Cada inicio de sesión del equipo queda en la bitácora.</span>
      </div>
    </AuthShell>
  );
}
