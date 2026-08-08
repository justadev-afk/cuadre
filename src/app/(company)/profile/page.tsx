/**
 * Screen 13 — the company user's own profile: their identity, a password
 * change, and a way out. The email is read-only here; changing it is not part
 * of the v1.
 */
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { pageMeta } from '../../_lib/page-meta.ts';
import { initialsOf } from '../../_lib/venezuela-format.ts';
import { ChangePasswordForm } from './change-password-form.tsx';

export const metadata = pageMeta('Perfil');

export default async function ProfilePage() {
  const { resolved } = await requireCompany();
  const { name, email } = resolved.session;

  return (
    <ContentLayout title="Ajustes" subtitle="Tu perfil, tu contraseña y la salida.">
      <Card>
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[var(--color-accent-800)] font-heading text-[var(--color-accent-100)]">
            {initialsOf(name)}
          </span>
          <div>
            <div className="font-heading text-base">{name}</div>
            <span className="text-xs text-muted-foreground">Empresa</span>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="profile-email">Correo</Label>
          <Input id="profile-email" value={email ?? ''} readOnly className="opacity-70" />
        </div>

        <div className="my-0.5 h-px bg-border" />

        <h6 className="m-0">Cambiar contraseña</h6>
        <ChangePasswordForm />

        <div className="my-0.5 h-px bg-border" />

        <form action="/logout" method="post">
          <Button type="submit" variant="secondary" size="block">
            Cerrar sesión
          </Button>
        </form>
      </Card>
    </ContentLayout>
  );
}
