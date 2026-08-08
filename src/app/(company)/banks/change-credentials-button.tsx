'use client';

/**
 * "Cambiar credenciales" — **the connect modal, with the identity locked.**
 *
 * It asks for exactly what the alta asks for, so it renders exactly what the
 * alta renders: `credential-fields.tsx`, the same fields in the same order, with
 * the same optional-pairs disclosure and the same waiting overlay over the same
 * bank round trip. The bank and the environment are the account's identity, so
 * they show as the same two controls, disabled — to change them you connect a
 * new account. The secret fields start empty: the old secret is sealed and is
 * never read back. A refusal is a toast, so the modal never resizes.
 *
 * The same component serves the company panel and the admin's company-detail
 * page: the server action arrives as a prop, and an admin passes the target
 * `companyId`, rendered as a hidden field the admin action reads.
 */
import { useActionState, useState } from 'react';

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
import type {
  BankCredentialGroup,
  BankEnvironment,
} from '../../../application/ports/bank-gateway.ts';
import { Icon } from '../../_components/icon.tsx';
import { useActionOutcome } from '../../_lib/use-action-outcome.ts';
import { ConnectingOverlay } from './connecting-overlay.tsx';
import {
  BankIdentityFields,
  CredentialGroupFields,
  type CredentialValues,
} from './credential-fields.tsx';
import { requiredCredentialsFilled } from './credentials.ts';
import { CHANGE_CREDENTIALS_INITIAL, type ChangeCredentialsState } from './form-state.ts';

type ChangeCredentialsButtonProps = {
  /** The server action — `changeCredentialsAction` (company) or the admin one. */
  action: (previous: ChangeCredentialsState, form: FormData) => Promise<ChangeCredentialsState>;
  accountId: string;
  /** The target company, for the admin action; omitted for the company's own. */
  companyId?: string;
  bankId: string;
  bankLabel: string;
  environment: BankEnvironment;
  credentialGroups: readonly BankCredentialGroup[];
};

export function ChangeCredentialsButton({
  action,
  accountId,
  companyId,
  bankId,
  bankLabel,
  environment,
  credentialGroups,
}: ChangeCredentialsButtonProps) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, CHANGE_CREDENTIALS_INITIAL);
  const [values, setValues] = useState<CredentialValues>({});
  const setField = (key: string, value: string) =>
    setValues((previous) => ({ ...previous, [key]: value }));

  useActionOutcome(state, () => {
    setOpen(false);
    setValues({});
  });

  const canSave = requiredCredentialsFilled(credentialGroups, values);

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
          <ConnectingOverlay
            active={pending}
            title={`Verificando con ${bankLabel}`}
            steps={[
              `Autenticando con ${bankLabel}`,
              'Verificando las credenciales',
              'Guardando la cuenta',
            ]}
          />
          <input type="hidden" name="accountId" value={accountId} />
          {companyId !== undefined && <input type="hidden" name="companyId" value={companyId} />}

          <BankIdentityFields
            banks={[{ id: bankId, displayName: bankLabel, environments: [environment] }]}
            bankId={bankId}
            environment={environment}
            disabled={pending}
          />

          <CredentialGroupFields
            groups={credentialGroups}
            values={values}
            onChange={setField}
            disabled={pending}
            // One of these forms per connected account can sit on the page.
            idPrefix={`chg-${accountId}`}
            optionalHint="Las que dejes en blanco se eliminan de la cuenta."
          />

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
