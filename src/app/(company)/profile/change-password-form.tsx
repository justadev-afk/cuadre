'use client';

import { useActionState } from 'react';

import { FormNote } from '../../_components/form-note.tsx';
import { changePasswordAction } from './actions.ts';
import { CHANGE_PASSWORD_INITIAL } from './form-state.ts';

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, CHANGE_PASSWORD_INITIAL);

  return (
    <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="field">
        <label htmlFor="pw-current">Contraseña actual</label>
        <input
          className="input"
          id="pw-current"
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="pw-next">Nueva contraseña</label>
        <input
          className="input"
          id="pw-next"
          name="next"
          type="password"
          autoComplete="new-password"
          placeholder="Mínimo 8 caracteres"
          required
        />
      </div>

      {state.error !== null && <FormNote tone="error">{state.error}</FormNote>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button type="submit" className="btn btn-primary" disabled={pending}>
          Guardar
        </button>
      </div>
    </form>
  );
}
