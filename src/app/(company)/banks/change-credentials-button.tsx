'use client';

/**
 * "Cambiar credenciales" — a modal the shape of the connect one, for replacing a
 * connected account's OAuth pairs. The bank and the environment are shown
 * read-only (they are the account's identity; to change them you connect a new
 * account), and the secret fields start empty — the old secret is sealed and is
 * never read back. A refusal is a toast, so the modal never resizes.
 *
 * The same component serves the company panel and the admin's company-detail
 * page: the server action arrives as a prop, and an admin passes the target
 * `companyId`, rendered as a hidden field the admin action reads.
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
import type { BankCredentialGroup } from '../../../application/ports/bank-gateway.ts';
import { Icon } from '../../_components/icon.tsx';
import { toast } from '../../_lib/toast.ts';
import { CHANGE_CREDENTIALS_INITIAL, type ChangeCredentialsState } from './form-state.ts';

type ChangeCredentialsButtonProps = {
  /** The server action — `changeCredentialsAction` (company) or the admin one. */
  action: (previous: ChangeCredentialsState, form: FormData) => Promise<ChangeCredentialsState>;
  accountId: string;
  /** The target company, for the admin action; omitted for the company's own. */
  companyId?: string;
  bankLabel: string;
  environment: 'production' | 'sandbox';
  credentialGroups: readonly BankCredentialGroup[];
};

export function ChangeCredentialsButton({
  action,
  accountId,
  companyId,
  bankLabel,
  environment,
  credentialGroups,
}: ChangeCredentialsButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, CHANGE_CREDENTIALS_INITIAL);
  const [values, setValues] = useState<Record<string, string>>({});
  const setField = (key: string, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      setValues({});
    }
  }, [state.ok]);
  useEffect(() => {
    if (state.error) toast(state.error);
  }, [state]);

  // Verificar waits on the required (operate) group being filled.
  const canSave = credentialGroups
    .filter((group) => group.required)
    .every((group) =>
      group.fields.every((f) => (values[`${group.key}.${f.name}`] ?? '').trim() !== ''),
    );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-primary">
          Cambiar credenciales
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(470px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Cambiar credenciales · {bankLabel}</DialogTitle>
          <DialogDescription>
            Verificamos las credenciales nuevas contra el banco antes de guardarlas. El banco y el
            entorno no cambian; para eso conecta una cuenta nueva.
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="accountId" value={accountId} />
          {companyId !== undefined && <input type="hidden" name="companyId" value={companyId} />}

          <div className="flex gap-2 text-xs text-muted-foreground">
            <span className="rounded-[6px] bg-sidebar px-2 py-1">{bankLabel}</span>
            <span className="rounded-[6px] bg-sidebar px-2 py-1">
              {environment === 'production' ? 'Producción' : 'Sandbox'}
            </span>
          </div>

          {credentialGroups.map((group) => (
            <div key={group.key} className="flex flex-col gap-2.5">
              <div>
                <h6 className="m-0 text-primary">
                  {group.label}
                  {!group.required && (
                    <span className="ml-1.5 font-normal text-muted-foreground">· opcional</span>
                  )}
                </h6>
                {group.hint && (
                  <span className="mt-[3px] block text-[11px] text-muted-foreground">
                    {group.hint}
                  </span>
                )}
              </div>

              {group.fields.map((f) => {
                const key = `${group.key}.${f.name}`;
                return (
                  <div className="flex flex-col gap-1.5" key={key}>
                    <Label htmlFor={`chg-${key}`}>{f.label}</Label>
                    <Input
                      id={`chg-${key}`}
                      name={key}
                      type={f.secret ? 'password' : 'text'}
                      autoCapitalize="none"
                      autoComplete={f.secret ? 'new-password' : 'off'}
                      spellCheck={false}
                      className="font-mono text-[13px]"
                      placeholder={f.secret ? '••••••••' : undefined}
                      value={values[key] ?? ''}
                      onChange={(e) => setField(key, e.target.value)}
                      required={group.required}
                      disabled={pending}
                    />
                  </div>
                );
              })}
            </div>
          ))}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !canSave}>
              <Icon name="plugs-connected" />
              {pending ? 'Verificando…' : 'Verificar y guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
