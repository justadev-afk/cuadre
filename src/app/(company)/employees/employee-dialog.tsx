'use client';

/**
 * Screen 12 — the employee dialog, for creating a cashier and for editing
 * anybody on the payroll.
 *
 * **What it creates is always a cashier**: a username and a PIN, no role to
 * choose. What it *edits* can also be the merchant's own administrator, who
 * signs in with an email and a password — so the PIN field is a cashier's field
 * and simply is not rendered for anyone else. Their password is not resettable
 * from another person's screen; `/forgot-password` is the channel for that, and
 * it is the one that proves the inbox.
 *
 * The login handle never changes either way: a cashier's username is half of
 * the tuple `(company, username)` and an administrator's email is their
 * identity, so it is read-only in edit mode and not even submitted.
 *
 * Every field is controlled so a refusal keeps what was typed instead of React
 * resetting the form, and the refusal is a **toast** rather than a note in the
 * dialog — Radix keeps the modal a fixed size, and a growing error line would
 * jump it under the cursor.
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
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { API } from '../../_lib/endpoints.ts';
import { useActionOutcome } from '../../_lib/use-action-outcome.ts';
import { useEndpointAction } from '../../_lib/use-endpoint-action.ts';
import { CREATE_EMPLOYEE_INITIAL, type CreateEmployeeState } from './form-state.ts';

/** The person being edited — enough to prefill the form and scope the update. */
export type EditableEmployee = {
  readonly id: string;
  readonly name: string;
  /** Their login handle: a cashier's username, or an administrator's email. */
  readonly username: string;
  /** A PIN is a cashier's credential, so only a cashier is offered one. */
  readonly isCashier: boolean;
};

export function EmployeeDialog({
  employee,
  onClose,
}: {
  /** Present → edit that cashier; absent → create a new one. */
  employee?: EditableEmployee | null;
  onClose: () => void;
}) {
  const editing = employee != null;
  // Creating always makes a cashier; editing offers a PIN only to one.
  const hasPin = !editing || employee.isCashier;
  const [state, action, pending] = useEndpointAction<CreateEmployeeState>(
    editing ? API.employeesUpdate : API.employeesCreate,
    CREATE_EMPLOYEE_INITIAL,
  );

  const [name, setName] = useState(employee?.name ?? '');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');

  // Close on success; surface a refusal as a toast, never resizing the modal.
  useActionOutcome(state, onClose);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="w-[min(420px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar empleado' : 'Nuevo empleado'}</DialogTitle>
          <DialogDescription>
            {!editing
              ? 'Entra con el código de la empresa y su PIN.'
              : hasPin
                ? 'Cambia el nombre o restablece el PIN. El usuario no cambia.'
                : 'Cambia el nombre. El correo no cambia, y la contraseña se restablece desde «¿Olvidaste tu contraseña?».'}
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="flex flex-col gap-3.5">
          {editing && <input type="hidden" name="userId" value={employee.id} />}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-name">Nombre y apellido</Label>
            <Input
              id="emp-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              disabled={pending}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-username">{editing && !hasPin ? 'Correo' : 'Usuario'}</Label>
            {editing ? (
              <Input id="emp-username" value={employee.username} readOnly className="opacity-70" />
            ) : (
              <Input
                id="emp-username"
                name="username"
                placeholder="maria.r"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={24}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={pending}
                required
              />
            )}
          </div>

          {hasPin && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp-pin">{editing ? 'Nuevo PIN (opcional)' : 'PIN de caja'}</Label>
              <Input
                id="emp-pin"
                name="pin"
                inputMode="numeric"
                placeholder={editing ? 'Dejar en blanco para no cambiarlo' : '4 a 6 dígitos'}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                maxLength={6}
                disabled={pending}
                required={!editing}
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {editing ? 'Guardar' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
