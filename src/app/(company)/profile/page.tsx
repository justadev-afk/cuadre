/**
 * Screen 13 — the company user's own profile: their identity, a password
 * change, and a way out. The email is read-only here; changing it is not part
 * of the v1.
 */
import { AppNav } from '../../_components/app-nav.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { initialsOf } from '../../_lib/venezuela-format.ts';
import { COMPANY_LINKS } from '../_lib/nav.ts';
import { ChangePasswordForm } from './change-password-form.tsx';

export const metadata = { title: 'Perfil · Cuadre' };

export default async function ProfilePage() {
  const { resolved } = await requireCompany();
  const { name, email } = resolved.session;

  return (
    <>
      <AppNav links={COMPANY_LINKS} current="/profile" roleLabel="Empresa" who={name} />

      <main style={{ padding: '26px 24px', maxWidth: 460, marginInline: 'auto', width: '100%' }}>
        <div className="card" style={{ background: 'var(--color-bg)', gap: 14, padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="avatar" style={{ width: 44, height: 44 }}>
              {initialsOf(name)}
            </span>
            <div>
              <div style={{ fontFamily: 'var(--font-heading)', fontSize: 16 }}>{name}</div>
              <span className="text-muted" style={{ fontSize: 12 }}>
                Empresa
              </span>
            </div>
          </div>

          <div className="field">
            <label htmlFor="profile-email">Correo</label>
            <input id="profile-email" className="input" value={email ?? ''} readOnly />
          </div>

          <div style={{ height: 1, background: 'var(--color-divider)', margin: '2px 0' }} />

          <h6 style={{ margin: 0 }}>Cambiar contraseña</h6>
          <ChangePasswordForm />

          <div style={{ height: 1, background: 'var(--color-divider)', margin: '2px 0' }} />

          <form action="/logout" method="post">
            <button type="submit" className="btn btn-secondary btn-block">
              Cerrar sesión
            </button>
          </form>
        </div>
      </main>
    </>
  );
}
