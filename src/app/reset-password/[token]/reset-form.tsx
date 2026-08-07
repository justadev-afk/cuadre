'use client';

/**
 * The new-password form. The token is a hidden field, carried from the URL the
 * mail linked to; the action reads it there.
 */
import { useActionState } from 'react';

import { FormNote } from '../../_components/form-note.tsx';
import { resetPasswordAction } from './actions.ts';
import { RESET_INITIAL } from './form-state.ts';

export function ResetForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, RESET_INITIAL);

  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />

      <div className="auth-fields">
        <div className="field">
          <label htmlFor="reset-password">Nueva contraseña</label>
          <input
            className="input"
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Mínimo 8 caracteres"
            required
          />
        </div>
        <div className="field">
          <label htmlFor="reset-confirm">Repite la contraseña</label>
          <input
            className="input"
            id="reset-confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>
      </div>

      {state.error !== null && <FormNote tone="error">{state.error}</FormNote>}

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={pending}
        style={{ marginTop: 18, minHeight: 40 }}
      >
        Guardar contraseña
      </button>
    </form>
  );
}
