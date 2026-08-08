'use client';

/**
 * The credentials form itself — the fields, and nothing around them.
 *
 * Connecting a bank and changing a connected account's credentials ask the
 * merchant for **the same thing**: which bank, which environment, and one pair
 * per service the bank declares. They were two hand-rolled forms that had
 * already drifted (one hid the optional pairs, the other did not; one showed the
 * bank as a picker, the other as a chip), so this is the single one they both
 * render. What differs between the two flows is only what is around it: the
 * title, the hidden ids, the action and what happens on success.
 *
 * Nothing here names a bank. It renders whatever `credentialGroups` it is handed
 * — that is the whole reason adding a bank stays an adapter plus a registry
 * entry.
 */
import { useState } from 'react';

import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { cn } from '@/lib/utils.ts';
import type {
  BankCredentialGroup,
  BankEnvironment,
} from '../../../application/ports/bank-gateway.ts';
import { Icon } from '../../_components/icon.tsx';
import { SearchableSelect, type SelectOption } from '../../_components/searchable-select.tsx';
import { credentialFieldName } from './credentials.ts';

/** The pair-per-service values the form holds, keyed by `credentialFieldName`. */
export type CredentialValues = Record<string, string>;

/** The bank the fields belong to, as far as this form needs to know it. */
export type BankChoice = {
  readonly id: string;
  readonly displayName: string;
  readonly environments: readonly BankEnvironment[];
};

/**
 * Which bank, and which environment. Editable while connecting; locked once the
 * account exists — bank and environment are its identity, and changing them is
 * connecting a *new* account, not editing this one. Locked renders the same two
 * controls, disabled, rather than a different widget: the merchant should
 * recognise the form they filled in the first place.
 */
export function BankIdentityFields({
  banks,
  bankId,
  environment,
  onBankChange,
  onEnvironmentChange,
  disabled = false,
}: {
  banks: readonly BankChoice[];
  bankId: string;
  environment: BankEnvironment;
  /** Absent → locked: this is the account's identity, shown but not changeable. */
  onBankChange?: (id: string) => void;
  onEnvironmentChange?: (environment: BankEnvironment) => void;
  disabled?: boolean;
}) {
  const locked = onBankChange === undefined;
  const selected = banks.find((bank) => bank.id === bankId) ?? banks[0];
  const environments = selected?.environments ?? [environment];
  const options: readonly SelectOption[] = banks.map((bank) => ({
    value: bank.id,
    label: bank.displayName,
  }));

  return (
    <>
      {/* The wire fields, so the action reads the choice and not the label.
          A locked pair belongs to the account already: nothing to submit. */}
      {!locked && (
        <>
          <input type="hidden" name="bank" value={bankId} />
          <input type="hidden" name="environment" value={environment} />
        </>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bank-select">Banco</Label>
        <SearchableSelect
          id="bank-select"
          options={options}
          value={bankId}
          onChange={(id) => onBankChange?.(id)}
          searchPlaceholder="Buscar banco…"
          disabled={disabled || locked}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-foreground/70">Entorno</span>
        <Tabs
          value={environment}
          onValueChange={(value) => onEnvironmentChange?.(value as BankEnvironment)}
        >
          <TabsList>
            {environments.map((env) => (
              <TabsTrigger key={env} value={env} disabled={disabled || locked}>
                <Icon name={env === 'sandbox' ? 'flask' : 'broadcast'} />
                {env === 'production' ? 'Producción' : 'Sandbox'}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
    </>
  );
}

/**
 * One pair of fields per credential group. The required ones (the pair the
 * counter runs on) open the form; the optional ones hide behind a disclosure, so
 * a merchant with two pairs sees two fields and reveals the rest only if they
 * have them.
 */
export function CredentialGroupFields({
  groups,
  values,
  onChange,
  disabled = false,
  idPrefix = 'cred',
  optionalHint,
}: {
  groups: readonly BankCredentialGroup[];
  values: CredentialValues;
  onChange: (name: string, value: string) => void;
  disabled?: boolean;
  /** Distinguishes the ids when more than one of these forms is on the page. */
  idPrefix?: string;
  /** Extra copy under the disclosure — what leaving an optional pair blank means. */
  optionalHint?: string;
}) {
  const [showExtras, setShowExtras] = useState(false);
  const required = groups.filter((group) => group.required);
  const optional = groups.filter((group) => !group.required);

  const renderGroup = (group: BankCredentialGroup) => (
    <div key={group.key} className="flex flex-col gap-2.5">
      <div>
        <h6 className="m-0 text-primary">{group.label}</h6>
        {group.hint && (
          <span className="mt-[3px] block text-[11px] text-muted-foreground">{group.hint}</span>
        )}
      </div>

      {group.fields.map((field) => {
        const name = credentialFieldName(group.key, field.name);
        const id = `${idPrefix}-${name}`;
        return (
          <div className="flex flex-col gap-1.5" key={name}>
            <Label htmlFor={id}>{field.label}</Label>
            <Input
              id={id}
              name={name}
              type={field.secret ? 'password' : 'text'}
              autoCapitalize="none"
              autoComplete={field.secret ? 'new-password' : 'off'}
              spellCheck={false}
              className="font-mono text-[13px]"
              value={values[name] ?? ''}
              onChange={(event) => onChange(name, event.target.value)}
              required={group.required}
              disabled={disabled}
            />
          </div>
        );
      })}
    </div>
  );

  return (
    <>
      {required.map(renderGroup)}

      {optional.length > 0 && (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            onClick={() => setShowExtras((shown) => !shown)}
            disabled={disabled}
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
          {showExtras && (
            <>
              {optionalHint && (
                <span className="-mt-2 block text-[11px] text-muted-foreground">
                  {optionalHint}
                </span>
              )}
              {optional.map(renderGroup)}
            </>
          )}
        </div>
      )}
    </>
  );
}
