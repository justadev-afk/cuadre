'use client';

/**
 * The accounts a connection receives transferencias in — one at a time, Enter to
 * add, and a chip per account.
 *
 * A textarea of numbers was worse than it looked: nothing was checked until the
 * form was submitted, so twenty digits with one missing came back as a refusal
 * of the whole thing, minutes after the mistake. Here each account is judged the
 * moment it is added, against the *bank's* rule — its length, its prefix, its
 * copy — and a refusal is a toast, never a line that resizes the dialog (§10).
 *
 * Nothing here knows that Banesco's are twenty digits beginning with 0134. It
 * reads `rule`, which the gateway declares; a bank with ten-digit numbers and no
 * prefix moves this field without a line changing in it.
 *
 * It is one component because two flows ask the same question (§11): connecting
 * a bank, and editing the list on a connected one. The list travels to the
 * server in one hidden input, newline-separated, which the actions parse with
 * the same `keepValidReceivingAccounts` the use case trusts.
 */
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import {
  checkReceivingAccount,
  type ReceivingAccountRefusal,
} from '../../../application/banking/receiving-accounts.ts';
import type { BankReceivingAccountRule } from '../../../application/ports/bank-gateway.ts';
import { Icon } from '../../_components/icon.tsx';

/** The name both server actions read this list back under. */
export const RECEIVING_ACCOUNTS_FIELD = 'receivingAccounts';

function refusalMessage(reason: ReceivingAccountRefusal, rule: BankReceivingAccountRule): string {
  if (reason === 'wrong_length') return `El número va completo: ${rule.digits} dígitos.`;
  if (reason === 'wrong_bank')
    return `Ese número no empieza por ${rule.prefix}, el código del banco.`;
  return 'Esa cuenta ya está en la lista.';
}

export function ReceivingAccountsField({
  rule,
  accounts,
  onChange,
  disabled = false,
  idPrefix = 'receiving',
}: {
  /** The bank's own shape. Null hides the field: this bank asks for none. */
  rule: BankReceivingAccountRule | null;
  accounts: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** One editor per connected bank can sit on a page; ids must not collide. */
  idPrefix?: string;
}) {
  const [typed, setTyped] = useState('');

  if (rule === null) return null;

  const add = (): void => {
    const raw = typed.trim();
    if (raw === '') return;

    const checked = checkReceivingAccount(rule, raw, accounts);
    if (!checked.ok) {
      toast.error(refusalMessage(checked.reason, rule));
      return;
    }

    onChange([...accounts, checked.account]);
    setTyped('');
  };

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${idPrefix}-account`}>{rule.label}</Label>

      {/* The list travels as one value; the chips below are what a person sees. */}
      <input type="hidden" name={RECEIVING_ACCOUNTS_FIELD} value={accounts.join('\n')} />

      <div className="flex gap-2">
        <Input
          id={`${idPrefix}-account`}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            // Enter adds the account and nothing else: inside a dialog it would
            // otherwise submit the form with a half-typed number in the box.
            if (event.key !== 'Enter') return;
            event.preventDefault();
            add();
          }}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          maxLength={rule.digits + 8}
          placeholder={rule.placeholder}
          disabled={disabled}
          className="font-mono tabular-nums"
        />
        <Button type="button" variant="secondary" onClick={add} disabled={disabled}>
          <Icon name="plus" />
          Agregar
        </Button>
      </div>

      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {accounts.map((account) => (
            <span
              key={account}
              className="inline-flex items-center gap-1.5 rounded-md bg-foreground/[0.06] py-1 pr-1 pl-2.5 font-mono text-[12px] tabular-nums"
            >
              {account}
              <button
                type="button"
                aria-label={`Quitar la cuenta ${account}`}
                disabled={disabled}
                onClick={() => onChange(accounts.filter((kept) => kept !== account))}
                className="grid size-5 place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>
      )}

      <span className="text-[11px] text-muted-foreground">
        Solo para transferencias. El número completo, {rule.digits} dígitos, uno a la vez. Sin
        ninguna, esta conexión valida pago móvil y la caja lo dice.
      </span>
    </div>
  );
}
