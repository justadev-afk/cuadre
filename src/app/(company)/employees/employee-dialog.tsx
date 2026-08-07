'use client';

/**
 * Screen 12 — the employee dialog, for both creating a cashier and editing one.
 *
 * A company's staff are cashiers with a username and a PIN; there is no role to
 * choose. Editing changes the name and, when a new PIN is typed, resets it —
 * the username is the login tuple `(company, username)` and never changes, so
 * it is read-only in edit mode and not even submitted.
 *
 * Every field is controlled so a refusal keeps what was typed instead of React
 * resetting the form, and the refusal is a **toast** rather than a note in the
 * dialog — Radix keeps the modal a fixed size, and a growing error line would
 * jump it under the cursor.
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
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { toast } from '../../_lib/toast.ts';
import { createEmployeeAction, updateEmployeeAction } from './actions.ts';
import { CREATE_EMPLOYEE_INITIAL } from './form-state.ts';

/** The cashier being edited — enough to prefill the form and scope the update. */
export type EditableEmployee = {
  readonly id: string;
  readonly name: string;
  readonly username: string;
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
  const [state, action, pending] = useActionState(
    editing ? updateEmployeeAction : createEmployeeAction,
    CREATE_EMPLOYEE_INITIAL,
  );

  const [name, setName] = useState(employee?.name ?? '');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');

  // Close on success; surface a refusal as a toast, never resizing the modal.
  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);
  useEffect(() => {
    if (state.error) toast(state.error);
  }, [state]);

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
            {editing
              ? 'Cambia el nombre o restablece el PIN. El usuario no cambia.'
              : 'Entra con el código de la empresa y su PIN.'}
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
            <Label htmlFor="emp-username">Usuario</Label>
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
