'use client';

/**
 * The bank-onboarding wizard, screens 19–23.
 *
 * Credentials → verifying → pick (or type) the account → connected. Nothing is
 * persisted until the last step, so abandoning it at any point leaves no row and
 * no decryptable secret behind.
 *
 * A bank asks for credentials in **groups**, one per service (Banesco: a
 * required Confirmación pair the counter runs on, and an optional Consulta pair
 * that lists the accounts). This file renders whatever groups it is handed and
 * has no per-bank knowledge. Every field is controlled so a refusal keeps what
 * the merchant typed — including which environment — instead of the action
 * wiping the form the way React resets an uncontrolled one. It renders inside a
 * shadcn `Dialog` (see `banks-panel.tsx`), so its heading is a `DialogTitle` and
 * the modal's own close button is the only X.
 */
import { useActionState, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { cn } from '@/lib/utils.ts';
import type { SupportedBank } from '../../../application/banking/list-supported-banks.ts';
import type { BankEnvironment } from '../../../application/ports/bank-gateway.ts';
import { formatBolivares } from '../../../domain/money.ts';
import { Icon } from '../../_components/icon.tsx';
import { SearchableSelect, type SelectOption } from '../../_components/searchable-select.tsx';
import { maskAccountNumber } from '../../_lib/masks.ts';
import { toast } from '../../_lib/toast.ts';
import { connectBankAction, verifyBankAction } from './actions.ts';
import { ConnectingOverlay } from './connecting-overlay.tsx';
import {
  CONNECT_INITIAL,
  type ConnectState,
  type SelectableAccountView,
  VERIFY_INITIAL,
  type VerifyState,
} from './form-state.ts';

type VerifyBankAction = (previous: VerifyState, form: FormData) => Promise<VerifyState>;
type ConnectBankAction = (previous: ConnectState, form: FormData) => Promise<ConnectState>;

type ConnectWizardProps = {
  /** Every bank a company can connect. One today (Banesco); the wizard is generic. */
  banks: readonly SupportedBank[];
  onClose: () => void;
  /** The verify/connect actions — default to the company's own; the admin panel
   *  passes its versions, scoped to a target company. */
  verifyAction?: VerifyBankAction;
  connectAction?: ConnectBankAction;
  /** When present (the admin flow), carried into both forms so the actions know
   *  which company they are setting up. */
  companyId?: string;
};

/** `confirmation.clientId`, `consulta.clientSecret` — one flat key per field. */
function fieldKey(groupKey: string, name: string): string {
  return `${groupKey}.${name}`;
}

export function ConnectWizard({
  banks,
  onClose,
  verifyAction = verifyBankAction,
  connectAction = connectBankAction,
  companyId,
}: ConnectWizardProps) {
  const [verify, verifyForm, verifying] = useActionState(verifyAction, VERIFY_INITIAL);

  // The chosen bank drives everything below it — its environments and its
  // declared credential groups. Switching bank resets the environment and
  // clears the fields, which belonged to the previous bank's groups.
  const [bankId, setBankId] = useState<string>(banks[0]?.id ?? '');
  const selectedBank = banks.find((b) => b.id === bankId) ?? banks[0];
  const [environment, setEnvironment] = useState<BankEnvironment>(
    banks[0]?.environments[0] ?? 'production',
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const setField = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  // The optional credential groups (Banesco's Consulta) hide behind a disclosure
  // so the form opens with only what is required — the merchant sees two fields,
  // not four, and reveals the rest only if they have them.
  const [showExtras, setShowExtras] = useState(false);

  const bankOptions: readonly SelectOption[] = banks.map((b) => ({
    value: b.id,
    label: b.displayName,
  }));
  const chooseBank = (id: string): void => {
    const next = banks.find((b) => b.id === id);
    if (next === undefined) return;
    setBankId(next.id);
    setEnvironment(next.environments[0] ?? 'production');
    setValues({});
    setShowExtras(false);
  };

  // A rejected credential set shows as a toast, never as an error line in the
  // form — the modal must not resize under the fields as the message appears.
  useEffect(() => {
    if (verify.step === 'error') toast(verify.message);
  }, [verify]);

  // The picker only ever holds a supported bank; the guard is for the compiler,
  // never rendered with an empty list (the page gates on `banks.length > 0`).
  if (selectedBank === undefined) return null;

  // The verify button waits on the required (operate) group being filled — a
  // realtime check, so an empty submit is never even offered.
  const canVerify = selectedBank.credentialGroups
    .filter((group) => group.required)
    .every((group) =>
      group.fields.every((f) => (values[fieldKey(group.key, f.name)] ?? '').trim() !== ''),
    );

  const requiredGroups = selectedBank.credentialGroups.filter((g) => g.required);
  const optionalGroups = selectedBank.credentialGroups.filter((g) => !g.required);

  const renderGroup = (group: (typeof selectedBank.credentialGroups)[number]) => (
    <div key={group.key} className="flex flex-col gap-2.5">
      <div>
        <h6 className="m-0 text-primary">{group.label}</h6>
        {group.hint && (
          <span className="mt-[3px] block text-[11px] text-muted-foreground">{group.hint}</span>
        )}
      </div>

      {group.fields.map((f) => {
        const key = fieldKey(group.key, f.name);
        return (
          <div className="flex flex-col gap-1.5" key={key}>
            <Label htmlFor={`cred-${key}`}>{f.label}</Label>
            <Input
              id={`cred-${key}`}
              name={key}
              type={f.secret ? 'password' : 'text'}
              autoCapitalize="none"
              autoComplete={f.secret ? 'new-password' : 'off'}
              spellCheck={false}
              className="font-mono text-[13px]"
              value={values[key] ?? ''}
              onChange={(e) => setField(key, e.target.value)}
              required={group.required}
              disabled={verifying}
            />
          </div>
        );
      })}
    </div>
  );

  // Once the credentials verify, the wizard moves to choosing the account.
  if (verify.step === 'accounts') {
    return (
      <AccountStep
        verifyId={verify.verifyId}
        environment={verify.environment}
        accounts={verify.accounts}
        displayName={selectedBank.displayName}
        connectAction={connectAction}
        companyId={companyId}
        onClose={onClose}
      />
    );
  }

  return (
    <form action={verifyForm} className="flex flex-col gap-4">
      <ConnectingOverlay
        active={verifying}
        title={`Conectando con ${selectedBank.displayName}`}
        steps={[
          `Autenticando con ${selectedBank.displayName}`,
          'Verificando las credenciales',
          'Consultando tus cuentas',
        ]}
      />
      <div>
        <DialogTitle>Conectar {selectedBank.displayName}</DialogTitle>
        <DialogDescription>
          Verificamos las credenciales contra el banco antes de guardar nada.
        </DialogDescription>
      </div>

      <input type="hidden" name="bank" value={bankId} />
      {companyId !== undefined && <input type="hidden" name="companyId" value={companyId} />}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bank-select">Banco</Label>
        <SearchableSelect
          id="bank-select"
          options={bankOptions}
          value={bankId}
          onChange={chooseBank}
          searchPlaceholder="Buscar banco…"
          disabled={verifying}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-foreground/70">Entorno</span>
        <input type="hidden" name="environment" value={environment} />
        <Tabs
          value={environment}
          onValueChange={(value) => setEnvironment(value as BankEnvironment)}
        >
          <TabsList>
            {selectedBank.environments.map((env) => (
              <TabsTrigger key={env} value={env} disabled={verifying}>
                <Icon name={env === 'sandbox' ? 'flask' : 'broadcast'} />
                {env === 'production' ? 'Producción' : 'Sandbox'}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {requiredGroups.map(renderGroup)}

      {optionalGroups.length > 0 && (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setShowExtras((v) => !v)}
            disabled={verifying}
            aria-expanded={showExtras}
            className="flex items-center gap-1.5 self-start text-sm text-primary hover:opacity-80 disabled:opacity-60"
          >
            <Icon
              name="caret-down"
              className={cn('transition-transform', showExtras && 'rotate-180')}
            />
            Credenciales extras
            <span className="font-normal text-muted-foreground">· opcional</span>
          </button>
          {showExtras && optionalGroups.map(renderGroup)}
        </div>
      )}

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={verifying || !canVerify}>
          <Icon name="plugs-connected" />
          {verifying ? 'Verificando…' : 'Verificar credenciales'}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Step 3 (screens 21–22) — choose the receiving account, then connect. */
function AccountStep({
  verifyId,
  environment,
  accounts,
  displayName,
  connectAction,
  companyId,
  onClose,
}: {
  verifyId: string;
  environment: 'production' | 'sandbox';
  accounts: readonly SelectableAccountView[];
  displayName: string;
  connectAction: ConnectBankAction;
  companyId?: string;
  onClose: () => void;
}) {
  const [connect, connectForm, connecting] = useActionState(connectAction, CONNECT_INITIAL);
  const [chosen, setChosen] = useState(accounts[0]?.accountId ?? '');
  const [typed, setTyped] = useState('');

  // A discover pair listed accounts → pick one; none did → type the number in.
  // Even with a list, the merchant can switch to typing: the account they bank
  // on may be masked in the list or belong to a different affiliation.
  const hasAccounts = accounts.length > 0;
  const [typing, setTyping] = useState(!hasAccounts);

  // The action revalidated /banks; closing drops the modal over the fresh list.
  useEffect(() => {
    if (connect.step === 'done') onClose();
  }, [connect.step, onClose]);

  // A connect failure is a toast, not an error line — same no-resize rule.
  useEffect(() => {
    if (connect.step === 'error') toast(connect.message);
  }, [connect]);

  // A Venezuelan account number is exactly 20 digits: Guardar waits for all 20,
  // and a partial number turns the field red as it is typed.
  const typedDigits = typed.replace(/\D/g, '');
  const accountComplete = typedDigits.length === 20;
  const accountInvalid = typedDigits.length > 0 && !accountComplete;

  const saveLabel = connecting
    ? 'Guardando…'
    : environment === 'sandbox'
      ? 'Guardar banco (sandbox)'
      : 'Guardar banco';

  return (
    <form action={connectForm} className="flex flex-col gap-4">
      <ConnectingOverlay
        active={connecting}
        title="Guardando la cuenta"
        steps={['Sellando las credenciales', 'Guardando la cuenta', 'Casi listo']}
      />
      <input type="hidden" name="verifyId" value={verifyId} />
      {companyId !== undefined && <input type="hidden" name="companyId" value={companyId} />}
      {/* connect prefers a typed number when present; sending both keeps the
          picker's choice available the moment the merchant switches back. */}
      <input type="hidden" name="accountId" value={typing ? '' : chosen} />
      <input type="hidden" name="accountNumber" value={typing ? typed : ''} />

      <div>
        <DialogTitle>¿Qué cuenta recibe los pagos?</DialogTitle>
        <DialogDescription>
          {typing
            ? 'Escribe el número completo de la cuenta que recibe los pagos.'
            : `${displayName} reporta ${accounts.length} ${accounts.length === 1 ? 'cuenta' : 'cuentas'} para estas credenciales.`}
        </DialogDescription>
      </div>

      {typing ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="manual-account">Número de cuenta (20 dígitos)</Label>
          <Input
            id="manual-account"
            aria-invalid={accountInvalid}
            className="font-mono tabular-nums"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            placeholder="0134 0000 0000 0000 0000"
            value={typed}
            onChange={(e) => setTyped(maskAccountNumber(e.target.value))}
            disabled={connecting}
          />
          {hasAccounts && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-1 self-start"
              onClick={() => setTyping(false)}
              disabled={connecting}
            >
              <Icon name="arrow-left" />
              Volver a la lista
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {accounts.map((account) => {
            const selected = account.accountId === chosen;
            return (
              <button
                type="button"
                key={account.accountId}
                onClick={() => setChosen(account.accountId)}
                disabled={connecting}
                className={cn(
                  'flex cursor-pointer flex-row items-center gap-3 rounded-md bg-card p-3.5 text-left',
                  selected
                    ? 'shadow-[inset_0_0_0_1px_var(--color-accent)]'
                    : 'shadow-[var(--shadow-sm)]',
                )}
              >
                <span
                  className={cn(
                    'size-4 flex-none rounded-full border-[1.5px]',
                    selected
                      ? 'border-primary bg-primary shadow-[inset_0_0_0_4px_var(--color-surface)]'
                      : 'border-border',
                  )}
                />
                <span className="flex-1">
                  <span className="block font-heading text-[15px] tabular-nums">
                    {account.masked}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {account.type ?? 'Cuenta'}
                    {account.balanceCents !== null &&
                      ` · saldo ${formatBolivares(account.balanceCents)}`}
                  </span>
                </span>
              </button>
            );
          })}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="self-start"
            onClick={() => setTyping(true)}
            disabled={connecting}
          >
            La cuenta no está en la lista — escribir el número
          </Button>
        </div>
      )}

      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <Icon name="eye" className="mt-0.5" />
        <span>Solo leemos los movimientos del día de esta cuenta. Cuadre no mueve dinero.</span>
      </div>

      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onClose} disabled={connecting}>
          Cancelar
        </Button>
        <Button type="submit" disabled={connecting || (typing ? !accountComplete : chosen === '')}>
          {saveLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}
