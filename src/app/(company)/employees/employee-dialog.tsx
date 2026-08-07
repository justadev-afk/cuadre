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
 * dialog — the modal must not resize under the fields the way an error line
 * pushed in would.
 */
import { useActionState, useEffect, useState } from 'react';

import { ModalBackdrop } from '../../_components/modal.tsx';
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
    <ModalBackdrop onClose={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={editing ? 'Editar empleado' : 'Nuevo empleado'}
        className="dialog elev-lg"
        style={{
          width: 'min(420px, 96vw)',
          gap: 14,
          padding: 24,
          background: 'var(--color-neutral-900)',
        }}
      >
        <div>
          <div className="dialog-title">{editing ? 'Editar empleado' : 'Nuevo empleado'}</div>
          <span className="text-muted" style={{ fontSize: 13 }}>
            {editing
              ? 'Cambia el nombre o restablece el PIN. El usuario no cambia.'
              : 'Entra con el código de la empresa y su PIN.'}
          </span>
        </div>

        <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {editing && <input type="hidden" name="userId" value={employee.id} />}

          <div className="field">
            <label htmlFor="emp-name">Nombre y apellido</label>
            <input
              className="input"
              id="emp-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              disabled={pending}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="emp-username">Usuario</label>
            {editing ? (
              <input className="input" id="emp-username" value={employee.username} readOnly />
            ) : (
              <input
                className="input"
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

          <div className="field">
            <label htmlFor="emp-pin">{editing ? 'Nuevo PIN (opcional)' : 'PIN de caja'}</label>
            <input
              className="input"
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

          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={pending}
            >
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={pending}>
              {editing ? 'Guardar' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </ModalBackdrop>
  );
}
