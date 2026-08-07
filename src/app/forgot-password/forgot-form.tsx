'use client';

/**
 * Screen 04's form. Client so the "revisa tu correo" confirmation replaces the
 * field in place — the same answer whether or not the address was found.
 */
import { useActionState } from 'react';

import { FormNote } from '../_components/form-note.tsx';
import { requestResetAction } from './actions.ts';
import { FORGOT_INITIAL } from './form-state.ts';

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestResetAction, FORGOT_INITIAL);

  if (state.done) {
    return (
      <FormNote tone="success">
        Si ese correo tiene una cuenta, le enviamos un enlace para crear una contraseña nueva. Vence
        en 30 minutos.
      </FormNote>
    );
  }

  return (
    <form action={action}>
      <div className="field">
        <label htmlFor="forgot-email">Correo de la cuenta</label>
        <input
          className="input"
          id="forgot-email"
          name="email"
          type="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="tu@empresa.com"
          required
        />
      </div>

      {state.error !== null && <FormNote tone="error">{state.error}</FormNote>}

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={pending}
        style={{ marginTop: 18, minHeight: 40 }}
      >
        Enviar enlace
      </button>
    </form>
  );
}
