'use client';

/**
 * Screen 07 — the "nueva empresa" dialog, a native `<dialog>` toggled by a
 * button. Client only because a dialog opens and closes, and because the form's
 * refusal (a taken slug, a bad RIF) is shown in place without leaving the list.
 *
 * The fields are controlled, on purpose: React resets an uncontrolled form once
 * its action returns, so an uncontrolled version would wipe everything the admin
 * typed the moment the server said "RIF inválido". Holding the values in state
 * keeps them through a refusal — and lets the RIF format itself as it is typed.
 *
 * On success the action revalidates the list and the dialog closes itself.
 */
import { useActionState, useEffect, useRef, useState } from 'react';

import { FormNote } from '../../_components/form-note.tsx';
import { Icon } from '../../_components/icon.tsx';
import { maskRif } from '../../_lib/masks.ts';
import { createCompanyAction } from './actions.ts';
import { CREATE_COMPANY_INITIAL } from './form-state.ts';

export function NewCompanyDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createCompanyAction, CREATE_COMPANY_INITIAL);

  const [name, setName] = useState('');
  const [rif, setRif] = useState('');
  const [slug, setSlug] = useState('');
  const [industry, setIndustry] = useState('');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [revealPassword, setRevealPassword] = useState(false);

  // Drive the native dialog from React state so Escape and the backdrop close
  // it the same way the buttons do.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Close once the server confirms the create, and clear the fields so the next
  // "Nueva empresa" opens blank rather than on the company just created. The
  // setters are stable, so `[state.ok]` is the whole dependency list.
  useEffect(() => {
    if (!state.ok) return;
    setOpen(false);
    setName('');
    setRif('');
    setSlug('');
    setIndustry('');
    setAdminName('');
    setAdminEmail('');
    setAdminPassword('');
    setRevealPassword(false);
  }, [state.ok]);

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <Icon name="plus" />
        Nueva empresa
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        style={{ border: 'none', background: 'transparent', padding: 0, maxWidth: '100%' }}
      >
        <div
          className="dialog elev-lg"
          style={{
            width: 'min(470px, 96vw)',
            gap: 16,
            padding: 26,
            background: 'var(--color-neutral-900)',
          }}
        >
          <div>
            <div className="dialog-title">Nueva empresa</div>
            <span className="text-muted" style={{ fontSize: 13 }}>
              Se crea con un usuario administrador de empresa.
            </span>
          </div>

          <form action={action} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="field" style={{ gridColumn: 'span 2' }}>
                <label htmlFor="nc-name">Nombre comercial</label>
                <input
                  className="input"
                  id="nc-name"
                  name="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="nc-rif">RIF</label>
                <input
                  className="input tnum"
                  id="nc-rif"
                  name="rif"
                  placeholder="J-40123456-7"
                  inputMode="text"
                  autoCapitalize="characters"
                  spellCheck={false}
                  value={rif}
                  onChange={(e) => setRif(maskRif(e.target.value))}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="nc-slug">Código de empresa</label>
                <input
                  className="input"
                  id="nc-slug"
                  name="slug"
                  placeholder="la-espiga"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  required
                />
              </div>
              <div className="field" style={{ gridColumn: 'span 2' }}>
                <label htmlFor="nc-industry">Rubro</label>
                <input
                  className="input"
                  id="nc-industry"
                  name="industry"
                  placeholder="Panadería"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                />
              </div>
            </div>

            <div style={{ height: 1, background: 'var(--color-divider)' }} />

            <div>
              <h6 style={{ margin: '0 0 10px', color: 'var(--color-accent)' }}>
                Usuario administrador
              </h6>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label htmlFor="nc-admin-name">Nombre y apellido</label>
                  <input
                    className="input"
                    id="nc-admin-name"
                    name="adminName"
                    value={adminName}
                    onChange={(e) => setAdminName(e.target.value)}
                    required
                  />
                </div>
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label htmlFor="nc-admin-email">Correo</label>
                  <input
                    className="input"
                    id="nc-admin-email"
                    name="adminEmail"
                    type="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="field" style={{ gridColumn: 'span 2' }}>
                  <label htmlFor="nc-admin-password">Contraseña temporal</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      className="input"
                      id="nc-admin-password"
                      name="adminPassword"
                      // Masked by default — it is a credential — but revealable,
                      // because whoever creates it has to read it back to the
                      // merchant, and a hidden field they cannot verify is how a
                      // typo becomes a support call.
                      type={revealPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      style={{ paddingRight: 40 }}
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      required
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      aria-label={
                        revealPassword ? 'Ocultar la contraseña' : 'Mostrar la contraseña'
                      }
                      onClick={() => setRevealPassword((v) => !v)}
                      style={{
                        position: 'absolute',
                        right: 2,
                        top: '50%',
                        transform: 'translateY(-50%)',
                      }}
                    >
                      <Icon name="eye" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {state.error !== null && <FormNote tone="error">{state.error}</FormNote>}

            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                Cancelar
              </button>
              <button type="submit" className="btn btn-primary" disabled={pending}>
                Crear empresa
              </button>
            </div>
          </form>
        </div>
      </dialog>
    </>
  );
}
