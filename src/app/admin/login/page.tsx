/**
 * Screen 03 — `/admin/login`, the platform team's door.
 *
 * A separate, unlinked route: nothing in the merchant product points here, and
 * the brand mark goes neutral with a shield so the team's own sign-in never
 * looks like the thing they operate. The copy says as much — the companies and
 * cashiers enter through `/login`.
 */
import { redirect } from 'next/navigation';

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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'auto' }}>
        <Brand internal size={24} />
        <span className="tag tag-neutral" style={{ marginLeft: 'auto' }}>
          Interno
        </span>
      </div>

      <h4 style={{ margin: '0 0 2px' }}>Administración</h4>
      <p className="text-muted" style={{ fontSize: 12, marginBottom: 18 }}>
        Acceso del equipo de Cuadre. Las empresas y los cajeros entran por{' '}
        <code style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>/login</code>.
      </p>

      <AdminLoginForm />

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          fontSize: 11,
          color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
          marginTop: 'auto',
        }}
      >
        <Icon name="lock-key" style={{ marginTop: 2 }} />
        <span>Ruta no enlazada. Cada inicio de sesión del equipo queda en la bitácora.</span>
      </div>
    </AuthShell>
  );
}
