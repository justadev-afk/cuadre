'use client';

/**
 * "Cuentas receptoras" on a connected bank — the same field the alta asks with,
 * pre-filled with what is stored.
 *
 * The list changes after a bank is connected: an account is closed, a second one
 * opens, or a digit was typed wrong and the till has been answering *todavía no
 * aparece* ever since. Editing it needs no bank round trip and no credentials —
 * these are the merchant's own numbers — so the dialog is the field, a submit,
 * and nothing else.
 *
 * It renders `ReceivingAccountsField`, the very component the connect wizard
 * renders, rather than a second one that looks like it (§11).
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
import type { BankReceivingAccountRule } from '../../../application/ports/bank-gateway.ts';
import { Icon } from '../../_components/icon.tsx';
import { useActionOutcome } from '../../_lib/use-action-outcome.ts';
import { RECEIVING_ACCOUNTS_INITIAL, type ReceivingAccountsState } from './form-state.ts';
import { ReceivingAccountsField } from './receiving-accounts-field.tsx';

export function ReceivingAccountsButton({
  action,
  accountId,
  companyId,
  bankLabel,
  rule,
  accounts,
}: {
  action: (previous: ReceivingAccountsState, form: FormData) => Promise<ReceivingAccountsState>;
  accountId: string;
  /** The target company, for the admin action; omitted for the company's own. */
  companyId?: string;
  bankLabel: string;
  rule: BankReceivingAccountRule | null;
  accounts: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(action, RECEIVING_ACCOUNTS_INITIAL);
  const [edited, setEdited] = useState<string[]>([...accounts]);

  // Close on success, toast on refusal — the one pair of effects every action
  // dialog here shares.
  useActionOutcome(state, () => setOpen(false));

  // A bank that never asks for a receiving account has nothing to edit.
  if (rule === null) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Re-opening starts from what is stored, never from a half-finished
        // edit the merchant walked away from.
        if (next) setEdited([...accounts]);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          <Icon name="bank" />
          Cuentas
          {accounts.length > 0 && (
            <span className="tabular-nums text-muted-foreground">{accounts.length}</span>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent className="w-[min(480px,calc(100%-2rem))]">
        <form action={formAction} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Cuentas de {bankLabel}</DialogTitle>
            <DialogDescription>
              Las cuentas donde recibes transferencias. El banco no las puede dar completas, por eso
              se cargan aquí.
            </DialogDescription>
          </DialogHeader>

          <input type="hidden" name="accountId" value={accountId} />
          {companyId !== undefined && <input type="hidden" name="companyId" value={companyId} />}

          <ReceivingAccountsField
            rule={rule}
            accounts={edited}
            onChange={setEdited}
            disabled={pending}
          />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              Guardar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
