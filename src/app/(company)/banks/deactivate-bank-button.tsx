'use client';

/**
 * The one lever a company has over a connected bank, besides replacing its
 * credentials: turn it off. So this is a single "Desactivar" that confirms first
 * (a bank going dark at the counter is not a stray-click affordance) and reports
 * a refusal as a toast so the confirm dialog never resizes under it.
 */
import { useState } from 'react';

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
import { API } from '../../_lib/endpoints.ts';
import { useActionOutcome } from '../../_lib/use-action-outcome.ts';
import { useEndpointAction } from '../../_lib/use-endpoint-action.ts';
import { REMOVE_BANK_INITIAL, type RemoveBankState } from './form-state.ts';

export function DeactivateBankButton({
  accountId,
  name,
  label,
}: {
  accountId: string;
  name: string;
  /** The merchant's own name for the connection, when they gave one. */
  label: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useEndpointAction<RemoveBankState>(
    API.banksDeactivate,
    REMOVE_BANK_INITIAL,
  );

  useActionOutcome(state, () => setOpen(false));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive">
          Desactivar
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(400px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>
            Desactivar {name}
            {label === null ? '' : ` · ${label}`}
          </DialogTitle>
          <DialogDescription>
            Dejará de recibir consultas en la caja. El historial de validaciones se conserva y
            puedes volver a conectarlo cuando quieras.
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
