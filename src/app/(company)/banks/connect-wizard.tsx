'use client';

/**
 * Connecting a bank — one form, one submit.
 *
 * It was a wizard: credentials → verifying → pick the receiving account →
 * connected. The account step is gone (a pago móvil is found by phone, bank code
 * and date, never by the receiving account), and a wizard with one step is a
 * form. What is left asks the three things a connection actually is: which bank,
 * which environment, and the credentials — plus an optional name the merchant
 * gives it, which is what tells two Banesco affiliations apart in the counter's
 * "banco receptor" dropdown.
 *
 * The credentials fields are `credential-fields.tsx` — the same fields "cambiar
 * credenciales" renders, because the two flows ask the merchant for the same
 * thing and a merchant should not have to learn two forms for it (§11). Every
 * field is controlled so a refusal keeps what was typed — including which
 * environment — instead of the action wiping the form the way React resets an
 * uncontrolled one. It renders inside a shadcn `Dialog` (see `banks-panel.tsx`),
 * so its heading is a `DialogTitle` and the modal's own close button is the only X.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import type { SupportedBank } from '../../../application/banking/list-supported-banks.ts';
import type { BankEnvironment } from '../../../application/ports/bank-gateway.ts';
import { Icon } from '../../_components/icon.tsx';
import { API } from '../../_lib/endpoints.ts';
import { useActionOutcome } from '../../_lib/use-action-outcome.ts';
import { useEndpointAction } from '../../_lib/use-endpoint-action.ts';
import { ConnectingOverlay } from './connecting-overlay.tsx';
import {
  BankIdentityFields,
  CredentialGroupFields,
  type CredentialValues,
} from './credential-fields.tsx';
import { requiredCredentialsFilled } from './credentials.ts';
import { CONNECT_INITIAL, type ConnectState } from './form-state.ts';
import { ReceivingAccountsField } from './receiving-accounts-field.tsx';

type ConnectWizardProps = {
  /** Every bank a company can connect. One today (Banesco); the form is generic. */
  banks: readonly SupportedBank[];
  onClose: () => void;
  /** When present (the admin flow), carried into the form as the company being
   *  set up. One endpoint serves both callers and decides which id it honours. */
  companyId?: string;
};

export function ConnectWizard({ banks, onClose, companyId }: ConnectWizardProps) {
  const [state, formAction, pending] = useEndpointAction<ConnectState>(
    API.banksConnect,
    CONNECT_INITIAL,
  );

  // The chosen bank drives everything below it — its environments and its
  // declared credential groups. Switching bank resets the environment and
  // clears the fields, which belonged to the previous bank's groups.
  const [bankId, setBankId] = useState<string>(banks[0]?.id ?? '');
  const selectedBank = banks.find((b) => b.id === bankId) ?? banks[0];
  const [environment, setEnvironment] = useState<BankEnvironment>(
    banks[0]?.environments[0] ?? 'production',
  );
  const [label, setLabel] = useState('');
  const [receiving, setReceiving] = useState<string[]>([]);
  const [values, setValues] = useState<CredentialValues>({});
  const setField = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const chooseBank = (id: string): void => {
    const next = banks.find((b) => b.id === id);
    if (next === undefined) return;
    setBankId(next.id);
    setEnvironment(next.environments[0] ?? 'production');
    setValues({});
  };

  // Close on success, toast on refusal — the one pair of effects every action
  // dialog shares, so this one does not hand-roll them (§11). A rejected
  // credential set is a toast and never an error line in the form: the modal
  // must not resize under the fields as the message appears.
  useActionOutcome(state, onClose);

  // The picker only ever holds a supported bank; the guard is for the compiler,
  // never rendered with an empty list (the page gates on `banks.length > 0`).
  if (selectedBank === undefined) return null;

  // A realtime check on the required groups, so an empty submit is never offered.
  const canSubmit = requiredCredentialsFilled(selectedBank.credentialGroups, values);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <ConnectingOverlay
        active={pending}
        title={`Conectando con ${selectedBank.displayName}`}
        steps={[
          `Autenticando con ${selectedBank.displayName}`,
          'Verificando las credenciales',
          'Guardando el banco',
        ]}
      />
      <div>
        <DialogTitle>Conectar {selectedBank.displayName}</DialogTitle>
        <DialogDescription>
          Verificamos las credenciales contra el banco antes de guardar nada.
        </DialogDescription>
      </div>

      {companyId !== undefined && <input type="hidden" name="companyId" value={companyId} />}

      <BankIdentityFields
        banks={banks}
        bankId={bankId}
        environment={environment}
        onBankChange={chooseBank}
        onEnvironmentChange={setEnvironment}
        disabled={pending}
      />

      {/* The only new field. It is what the cashier will read in the "banco
          receptor" dropdown, so a shop with one Banesco can skip it and a shop
          with two really should not. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bank-label">Nombre (opcional)</Label>
        <Input
          id="bank-label"
          name="label"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          maxLength={40}
          autoComplete="off"
          placeholder="Caja principal"
          disabled={pending}
        />
        <span className="text-[11px] text-muted-foreground">
          Así lo verá el cajero al elegir el banco que recibe el pago.
        </span>
      </div>

      {/* Only a transferencia needs one, and only the merchant can give it:
          Consulta de Saldo reports the numbers masked and the payment search
          refuses a masked one, so the whole number is typed here — one at a
          time, checked as it is added. */}
      <ReceivingAccountsField
        rule={selectedBank.receivingAccountRule}
        accounts={receiving}
        onChange={setReceiving}
        disabled={pending}
      />

      <CredentialGroupFields
        groups={selectedBank.credentialGroups}
        values={values}
        onChange={setField}
        disabled={pending}
      />

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Icon name="eye" className="mt-0.5" />
        <span>Solo consultamos los pagos que valides en la caja. Cuadre no mueve dinero.</span>
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || !canSubmit}>
          <Icon name="plugs-connected" />
          {pending ? 'Conectando…' : 'Conectar banco'}
        </Button>
      </DialogFooter>
    </form>
  );
}
