'use client';

/**
 * Screen 07 — the "nueva empresa" dialog, a Radix modal opened from a button.
 *
 * The fields are controlled, on purpose: React resets an uncontrolled form once
 * its action returns, so an uncontrolled version would wipe everything the admin
 * typed the moment the server said "RIF inválido". Holding the values in state
 * keeps them through a refusal — and lets the RIF format itself as it is typed.
 *
 * A refusal is a **toast**, not a note grown inside the dialog, so the modal
 * never resizes under the cursor. On success the action revalidates the list
 * and the dialog closes itself.
 */
import { useActionState, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Separator } from '@/components/ui/separator.tsx';
import { Icon } from '../../_components/icon.tsx';
import { maskRif } from '../../_lib/masks.ts';
import { toast } from '../../_lib/toast.ts';
import { createCompanyAction } from './actions.ts';
import { CREATE_COMPANY_INITIAL } from './form-state.ts';

export function NewCompanyDialog() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createCompanyAction, CREATE_COMPANY_INITIAL);

  const [name, setName] = useState('');
  const [rif, setRif] = useState('');
  const [slug, setSlug] = useState('');
  const [industry, setIndustry] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [revealPassword, setRevealPassword] = useState(false);

  // Close once the server confirms the create, and clear the fields so the next
  // "Nueva empresa" opens blank rather than on the company just created.
  useEffect(() => {
    if (!state.ok) return;
    setOpen(false);
    setName('');
    setRif('');
    setSlug('');
    setIndustry('');
    setAdminName('');
    setAdminEmail('');
    setAdminPassword('');
    setRevealPassword(false);
  }, [state.ok]);
  useEffect(() => {
    if (state.error) toast(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Icon name="plus" />
          Nueva empresa
        </Button>
      </DialogTrigger>

      <DialogContent className="w-[min(470px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Nueva empresa</DialogTitle>
          <DialogDescription>Se crea con un usuario administrador de empresa.</DialogDescription>
        </DialogHeader>

        <form action={action} className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="nc-name">Nombre comercial</Label>
              <Input
                id="nc-name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nc-rif">RIF</Label>
              <Input
                id="nc-rif"
                name="rif"
                className="tabular-nums"
                placeholder="J-00000000-0"
                inputMode="text"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={13}
                value={rif}
                onChange={(e) => setRif(maskRif(e.target.value))}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nc-slug">Código de empresa</Label>
              <Input
                id="nc-slug"
                name="slug"
                placeholder="la-espiga"
                autoCapitalize="none"
                spellCheck={false}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                required
              />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="nc-industry">Rubro</Label>
              <Input
                id="nc-industry"
                name="industry"
                placeholder="Panadería"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
              />
            </div>
          </div>

          <Separator />

          <div>
            <h6 className="mb-2.5 text-primary">Usuario administrador</h6>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="nc-admin-name">Nombre y apellido</Label>
                <Input
                  id="nc-admin-name"
                  name="adminName"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="nc-admin-email">Correo</Label>
                <Input
                  id="nc-admin-email"
                  name="adminEmail"
                  type="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={adminEmail}
                  onChange={(e) => setAdminEmail(e.target.value)}
                  required
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1.5">
                <Label htmlFor="nc-admin-password">Contraseña temporal</Label>
                <div className="relative">
                  <Input
                    id="nc-admin-password"
                    name="adminPassword"
                    // Masked by default — it is a credential — but revealable,
                    // because whoever creates it has to read it back to the
                    // merchant, and a hidden field they cannot verify is how a
                    // typo becomes a support call.
                    type={revealPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    className="pr-10"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={revealPassword ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
                    onClick={() => setRevealPassword((v) => !v)}
                    className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
                  >
                    <Icon name="eye" />
                  </Button>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              Crear empresa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
