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
 * wiping the form the way React resets an uncontrolled one.
 */
import { useActionState, useEffect, useState } from 'react';

import type { BankCredentialGroup } from '../../../application/ports/bank-gateway.ts';
import { formatBolivares } from '../../../domain/money.ts';
import { Icon } from '../../_components/icon.tsx';
import { maskAccountNumber } from '../../_lib/masks.ts';
import { toast } from '../../_lib/toast.ts';
import { connectBankAction, verifyBankAction } from './actions.ts';
import { CONNECT_INITIAL, type SelectableAccountView, VERIFY_INITIAL } from './form-state.ts';

type ConnectWizardProps = {
  displayName: string;
  environments: readonly ('production' | 'sandbox')[];
  credentialGroups: readonly BankCredentialGroup[];
  onClose: () => void;
};

/** `confirmation.clientId`, `consulta.clientSecret` — one flat key per field. */
function fieldKey(groupKey: string, name: string): string {
  return `${groupKey}.${name}`;
}

export function ConnectWizard({
  displayName,
  environments,
  credentialGroups,
  onClose,
}: ConnectWizardProps) {
  const [verify, verifyAction, verifying] = useActionState(verifyBankAction, VERIFY_INITIAL);

  const [environment, setEnvironment] = useState<'production' | 'sandbox'>(
    environments[0] ?? 'sandbox',
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const setField = (key: string, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  // A rejected credential set shows as a toast, never as an error line in the
  // form — the modal must not resize under the fields as the message appears.
  useEffect(() => {
    if (verify.step === 'error') toast(verify.message);
  }, [verify]);

  // The verify button waits on the required (operate) group being filled — a
  // realtime check, so an empty submit is never even offered.
  const canVerify = credentialGroups
    .filter((group) => group.required)
    .every((group) =>
      group.fields.every((f) => (values[fieldKey(group.key, f.name)] ?? '').trim() !== ''),
    );

  // Once the credentials verify, the wizard moves to choosing the account.
  if (verify.step === 'accounts') {
    return (
      <AccountStep
        verifyId={verify.verifyId}
        environment={verify.environment}
        accounts={verify.accounts}
        displayName={displayName}
        onClose={onClose}
      />
    );
  }

  return (
    <form action={verifyAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div className="dialog-title">Conectar {displayName}</div>
          <span className="text-muted" style={{ fontSize: 13 }}>
            Verificamos las credenciales contra el banco antes de guardar nada.
          </span>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          aria-label="Cerrar"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </div>

      <fieldset className="field" style={{ border: 'none', padding: 0, margin: 0 }}>
        <legend
          style={{
            fontSize: 12,
            marginBottom: 5,
            padding: 0,
            color: 'color-mix(in srgb, var(--color-text) 70%, transparent)',
          }}
        >
          Entorno
        </legend>
        <div className="seg" style={{ width: '100%', marginTop: 2 }}>
          {environments.map((env) => (
            <label key={env} className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
              <input
                type="radio"
                name="environment"
                value={env}
                checked={environment === env}
                onChange={() => setEnvironment(env)}
                disabled={verifying}
              />
              <Icon name={env === 'sandbox' ? 'flask' : 'broadcast'} />
              {env === 'production' ? 'Producción' : 'Sandbox'}
            </label>
          ))}
        </div>
      </fieldset>

      {credentialGroups.map((group) => (
        <div key={group.key} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <h6 style={{ margin: 0, color: 'var(--color-accent)' }}>
              {group.label}
              {!group.required && (
                <span className="text-muted" style={{ marginLeft: 6, fontWeight: 400 }}>
                  · opcional
                </span>
              )}
            </h6>
            {group.hint && (
              <span className="text-muted" style={{ fontSize: 11, display: 'block', marginTop: 3 }}>
                {group.hint}
              </span>
            )}
          </div>

          {group.fields.map((f) => {
            const key = fieldKey(group.key, f.name);
            return (
              <div className="field" key={key}>
                <label htmlFor={`cred-${key}`}>{f.label}</label>
                <input
                  className="input"
                  id={`cred-${key}`}
                  name={key}
                  type={f.secret ? 'password' : 'text'}
                  autoCapitalize="none"
                  autoComplete={f.secret ? 'new-password' : 'off'}
                  spellCheck={false}
                  style={{ fontFamily: 'ui-monospace, monospace', fontSize: 13 }}
                  value={values[key] ?? ''}
                  onChange={(e) => setField(key, e.target.value)}
                  required={group.required}
                  disabled={verifying}
                />
              </div>
            );
          })}
        </div>
      ))}

      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-primary" disabled={verifying || !canVerify}>
          <Icon name="plugs-connected" />
          {verifying ? 'Verificando…' : 'Verificar credenciales'}
        </button>
      </div>
    </form>
  );
}

/** Step 3 (screens 21–22) — choose the receiving account, then connect. */
function AccountStep({
  verifyId,
  environment,
  accounts,
  displayName,
  onClose,
}: {
  verifyId: string;
  environment: 'production' | 'sandbox';
  accounts: readonly SelectableAccountView[];
  displayName: string;
  onClose: () => void;
}) {
  const [connect, connectAction, connecting] = useActionState(connectBankAction, CONNECT_INITIAL);
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
    <form action={connectAction} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <input type="hidden" name="verifyId" value={verifyId} />
      {/* connect prefers a typed number when present; sending both keeps the
          picker's choice available the moment the merchant switches back. */}
      <input type="hidden" name="accountId" value={typing ? '' : chosen} />
      <input type="hidden" name="accountNumber" value={typing ? typed : ''} />

      <div>
        <div className="dialog-title">¿Qué cuenta recibe los pagos?</div>
        <span className="text-muted" style={{ fontSize: 13 }}>
          {typing
            ? 'Escribe el número completo de la cuenta que recibe los pagos.'
            : `${displayName} reporta ${accounts.length} ${accounts.length === 1 ? 'cuenta' : 'cuentas'} para estas credenciales.`}
        </span>
      </div>

      {typing ? (
        <div className="field">
          <label htmlFor="manual-account">Número de cuenta (20 dígitos)</label>
          <input
            className={`input tnum${accountInvalid ? ' input-invalid' : ''}`}
            id="manual-account"
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            maxLength={24}
            placeholder="0134 0000 0000 0000 0000"
            value={typed}
            onChange={(e) => setTyped(maskAccountNumber(e.target.value))}
            disabled={connecting}
            style={{ fontFamily: 'ui-monospace, monospace' }}
          />
          {hasAccounts && (
            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 8, alignSelf: 'flex-start', fontSize: 12 }}
              onClick={() => setTyping(false)}
              disabled={connecting}
            >
              <Icon name="arrow-left" />
              Volver a la lista
            </button>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {accounts.map((account) => {
            const selected = account.accountId === chosen;
            return (
              <button
                type="button"
                key={account.accountId}
                onClick={() => setChosen(account.accountId)}
                disabled={connecting}
                className="card elev-sm"
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  padding: 14,
                  cursor: 'pointer',
                  textAlign: 'left',
                  background: 'var(--color-surface)',
                  ...(selected ? { boxShadow: 'inset 0 0 0 1px var(--color-accent)' } : {}),
                }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    flex: 'none',
                    borderRadius: '50%',
                    border: `1.5px solid ${selected ? 'var(--color-accent)' : 'var(--color-divider)'}`,
                    background: selected ? 'var(--color-accent)' : 'transparent',
                    boxShadow: selected ? 'inset 0 0 0 4px var(--color-surface)' : 'none',
                  }}
                />
                <span style={{ flex: 1 }}>
                  <span className="card-title tnum" style={{ fontSize: 15, display: 'block' }}>
                    {account.masked}
                  </span>
                  <span className="text-muted" style={{ fontSize: 12 }}>
                    {account.type ?? 'Cuenta'}
                    {account.balanceCents !== null &&
                      ` · saldo ${formatBolivares(account.balanceCents)}`}
                  </span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="btn btn-ghost"
            style={{ alignSelf: 'flex-start', fontSize: 12 }}
            onClick={() => setTyping(true)}
            disabled={connecting}
          >
            La cuenta no está en la lista — escribir el número
          </button>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 8,
          fontSize: 12,
          color: 'color-mix(in srgb, var(--color-text) 55%, transparent)',
        }}
      >
        <Icon name="eye" style={{ marginTop: 2 }} />
        <span>Solo leemos los movimientos del día de esta cuenta. Cuadre no mueve dinero.</span>
      </div>

      <div className="dialog-actions">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={connecting}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={connecting || (typing ? !accountComplete : chosen === '')}
        >
          {saveLabel}
        </button>
      </div>
    </form>
  );
}
