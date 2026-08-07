'use client';

/**
 * The admin sign-in form. Client only so the refusal can be shown in place —
 * a wrong password on an unlinked route should not become a URL somebody can
 * be handed.
 */

import { useActionState } from 'react';
import { FormNote } from '../../_components/form-note.tsx';
import { DeviceIdField } from '../../_lib/device-id-field.tsx';
import { NO_SIGN_IN_ERROR } from '../../_lib/sign-in-state.ts';
import { signInAdminAction } from './actions.ts';

export function AdminLoginForm() {
  const [state, action, pending] = useActionState(signInAdminAction, NO_SIGN_IN_ERROR);

  return (
    <form action={action}>
      <DeviceIdField />
      <div className="auth-fields">
        <div className="field">
          <label htmlFor="admin-email">Correo corporativo</label>
          <input
            className="input"
            id="admin-email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="admin-password">Contraseña</label>
          <input
            className="input"
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      </div>

      {state.error !== null && <FormNote tone="error">{state.error}</FormNote>}

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={pending}
        style={{ marginTop: 20, minHeight: 40 }}
      >
        Entrar
      </button>
    </form>
  );
}
