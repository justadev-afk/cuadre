'use client';

/**
 * The notice shown at `/login?ended=other-device`: the session was closed
 * because the same user signed in on another device.
 *
 * By the time this renders the cookie is already cleared (the `/session-ended`
 * route did it before forwarding here), so this is purely an explanation — it
 * dismisses to reveal the login form underneath. It follows the Nocturne
 * `.dialog` pattern from shift-dialog.tsx; every colour, space and radius comes
 * from a variable.
 */

import { useState } from 'react';

import { Icon } from '../_components/icon.tsx';
import { ModalBackdrop } from '../_components/modal.tsx';

export function SessionEndedModal() {
  const [open, setOpen] = useState(true);
  if (!open) return null;

  return (
    <ModalBackdrop onClose={() => setOpen(false)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Se cerró tu sesión"
        className="dialog elev-lg"
        style={{ width: 'min(420px, 100%)', gap: 'var(--space-6)', padding: 'var(--space-8)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            className="brand-mark"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              fontSize: 20,
              background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
            }}
          >
            <Icon name="sign-out" />
          </span>
          <div className="dialog-title" style={{ fontSize: 19 }}>
            Se cerró tu sesión
          </div>
        </div>

        <p className="dialog-body" style={{ margin: 0 }}>
          Tu sesión se cerró porque iniciaste sesión en otro dispositivo.
        </p>

        <button
          type="button"
          className="btn btn-primary btn-block"
          style={{ minHeight: 40 }}
          onClick={() => setOpen(false)}
        >
          Entendido
        </button>
      </div>
    </ModalBackdrop>
  );
}
