'use client';

/**
 * The one lever a company has over a connected account: turn it off. Not edit —
 * the sealed credentials and the fixed account number leave nothing to change —
 * so this is a single "Desactivar" that confirms first (a bank going dark at the
 * counter is not a stray-click affordance) and reports a refusal as a toast so
 * the confirm dialog never resizes under it.
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
import { toast } from '../../_lib/toast.ts';
import { removeBankAccountAction } from './actions.ts';
import { REMOVE_BANK_INITIAL } from './form-state.ts';

export function DeactivateBankButton({
  accountId,
  name,
  last4,
}: {
  accountId: string;
  name: string;
  last4: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(removeBankAccountAction, REMOVE_BANK_INITIAL);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);
  useEffect(() => {
    if (state.error) toast(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          Desactivar
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(400px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>Desactivar {name}</DialogTitle>
          <DialogDescription>
            La cuenta ···· {last4} dejará de recibir consultas en la caja. El historial de
            validaciones se conserva y puedes volver a conectarla cuando quieras.
          </DialogDescription>
        </DialogHeader>
        <form action={action}>
          <input type="hidden" name="accountId" value={accountId} />
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              Desactivar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
