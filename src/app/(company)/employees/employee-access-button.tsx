'use client';

/**
 * The one lever a merchant has over a person: their access, on or off.
 *
 * **It is never a delete.** `validations.cashier_id` names whoever confirmed
 * each payment, and that row has to keep naming them — so somebody who leaves is
 * disabled, which ends their next sign-in and the tills they already have open,
 * and somebody disabled by mistake is switched back on from the same button.
 *
 * Turning access *off* confirms first: a cashier losing the till mid-shift is
 * not a stray-click affordance. Turning it back on does not — it grants what the
 * merchant is looking at, and an accidental grant is undone by the button that
 * is right there.
 */
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Icon } from '../../_components/icon.tsx';
import { API } from '../../_lib/endpoints.ts';
import { toast } from '../../_lib/toast.ts';
import { useEndpointAction } from '../../_lib/use-endpoint-action.ts';
import { EMPLOYEE_ACCESS_INITIAL, type EmployeeAccessState } from './form-state.ts';

export function EmployeeAccessButton({
  userId,
  name,
  active,
}: {
  userId: string;
  name: string;
  /** Their status right now. It decides both the icon and what the click does. */
  active: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, submit, pending] = useEndpointAction<EmployeeAccessState>(
    API.employeesStatus,
    EMPLOYEE_ACCESS_INITIAL,
  );

  // The success sentence — *se desactivó, sus validaciones se conservan* — is
  // the endpoint's, because which of the two happened is the server's answer.
  // A ref keeps a re-render from toasting the same reply twice.
  const announced = useRef<EmployeeAccessState | null>(null);
  useEffect(() => {
    if (!state.ok || announced.current === state) return;
    announced.current = state;
    setConfirming(false);
    if (state.note) toast(state.note, 'success');
  }, [state]);

  useEffect(() => {
    if (state.error) toast(state.error);
  }, [state]);

  const send = (status: 'active' | 'disabled') => {
    const form = new FormData();
    form.set('userId', userId);
    form.set('status', status);
    submit(form);
  };

  if (!active) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Reactivar a ${name}`}
        title="Reactivar"
        disabled={pending}
        className="text-muted-foreground hover:text-primary"
        onClick={(event) => {
          event.stopPropagation();
          send('active');
        }}
      >
        <Icon name="power" />
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Desactivar a ${name}`}
        title="Desactivar"
        disabled={pending}
        className="text-muted-foreground hover:text-destructive"
        onClick={(event) => {
          event.stopPropagation();
          setConfirming(true);
        }}
      >
        <Icon name="prohibit" />
      </Button>

      <Dialog open={confirming} onOpenChange={setConfirming}>
        {/* The row underneath opens the edit dialog on click, and a click inside
            this one is still a click inside that row. */}
        <DialogContent
          className="w-[min(400px,calc(100%-2rem))]"
          onClick={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Desactivar a {name}</DialogTitle>
            <DialogDescription>
              No podrá entrar y se le cerrarán las sesiones abiertas. Sus validaciones se conservan
              y puedes reactivarlo cuando quieras.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setConfirming(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={() => send('disabled')}
            >
              Desactivar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
