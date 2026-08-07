'use client';

/**
 * Screen 12 — the "nuevo empleado" dialog.
 *
 * There is no role control. A company's staff are cashiers; the supervisor tier
 * the early design mocked was dropped, so this creates a cashier with a
 * username and a PIN and nothing to choose. A cashier has no email — their PIN
 * is reset by the company, which is the only channel they need.
 */
import { useActionState, useEffect, useState } from 'react';

import { FormNote } from '../../_components/form-note.tsx';
import { Icon } from '../../_components/icon.tsx';
import { createEmployeeAction } from './actions.ts';
import { CREATE_EMPLOYEE_INITIAL } from './form-state.ts';

export function NewEmployeeDialog() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createEmployeeAction, CREATE_EMPLOYEE_INITIAL);

  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Icon name="plus" />
        Nuevo empleado
      </button>

      {open && (
        <div className="dialog-backdrop">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Nuevo empleado"
            className="dialog elev-lg"
            style={{
              width: 'min(420px, 96vw)',
              gap: 14,
              padding: 24,
              background: 'var(--color-neutral-900)',
            }}
          >
            <div>
              <div className="dialog-title">Nuevo empleado</div>
              <span className="text-muted" style={{ fontSize: 13 }}>
                Entra con el código de la empresa y su PIN.
              </span>
            </div>

            <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field">
                <label htmlFor="ne-name">Nombre y apellido</label>
                <input className="input" id="ne-name" name="name" required />
              </div>
              <div className="field">
                <label htmlFor="ne-username">Usuario</label>
                <input
                  className="input"
                  id="ne-username"
                  name="username"
                  placeholder="maria.r"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="ne-pin">PIN de caja</label>
                <input
                  className="input"
                  id="ne-pin"
                  name="pin"
                  inputMode="numeric"
                  placeholder="4 a 6 dígitos"
                  required
                />
              </div>

              {state.error !== null && <FormNote tone="error">{state.error}</FormNote>}

              <div className="dialog-actions">
                <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn-primary" disabled={pending}>
                  Crear
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
