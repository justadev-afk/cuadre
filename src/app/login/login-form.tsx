'use client';

/**
 * Screens 01 and 02 — one screen with a two-tab role selector.
 *
 * Client, and only because of the tab: which door is open decides which server
 * action the form posts to, and a form cannot choose its action from CSS.
 * Everything the tab reveals is a real field in a real form, and the two forms
 * are separate elements rather than one form with a hidden role — so a
 * cashier's PIN is never sitting in the DOM of a merchant's submission, and
 * neither action can be reached with the other's fields.
 */

import Link from 'next/link';
import { useActionState, useEffect, useState } from 'react';

import { Brand } from '../_components/brand.tsx';
import { FormNote } from '../_components/form-note.tsx';
import { Icon, type IconName } from '../_components/icon.tsx';
import { NO_SIGN_IN_ERROR } from '../_lib/sign-in-state.ts';
import { signInCashierAction, signInCompanyAction } from './actions.ts';

/**
 * The company code, remembered per device — screen 02's «Recordar el código en
 * esta caja». A till belongs to one shop and the code does not change between
 * shifts, so re-typing it every morning is pure friction. It is not a
 * credential; the username and the PIN are, and neither is ever written here.
 */
const REMEMBERED_SLUG_KEY = 'cuadre.company-slug';

type Door = 'company' | 'cashier';

export type LoginNotice = { readonly tone: 'error' | 'success'; readonly text: string };

type LoginFormProps = {
  /** The path the middleware bounced them off, if any. */
  readonly next: string | null;
  /** A one-off line above the form: a finished reset, a session that ended. */
  readonly notice: LoginNotice | null;
};

export function LoginForm({ next, notice }: LoginFormProps) {
  const [door, setDoor] = useState<Door>('company');

  return (
    <>
      <div className="auth-panel">
        <div className="auth-top">
          <Brand size={24} />
        </div>

        <h1 className="auth-title">Entrar</h1>
        <p className="text-muted" style={{ fontSize: 13, marginBottom: 18 }}>
          {door === 'company'
            ? 'Elige tu tipo de acceso.'
            : 'Tu empresa te entrega el código y el PIN.'}
        </p>

        <div className="seg" style={{ width: '100%', marginBottom: 18 }}>
          <DoorTab
            door="company"
            current={door}
            onPick={setDoor}
            icon="storefront"
            label="Empresa"
          />
          <DoorTab
            door="cashier"
            current={door}
            onPick={setDoor}
            icon="cash-register"
            label="Cajero"
          />
        </div>

        {notice !== null && <FormNote tone={notice.tone}>{notice.text}</FormNote>}

        {door === 'company' ? <CompanyForm next={next} /> : <CashierForm next={next} />}
      </div>

      <aside className="auth-aside">
        <div className="auth-aside-rule" />
        <p className="auth-aside-quote">
          {door === 'company'
            ? 'Cobra, valida y entrega. Sin llamar al banco ni revisar el estado de cuenta.'
            : 'Confirma el pago móvil antes de entregar la compra.'}
        </p>

        <div className="auth-benefits">
          <Benefit
            icon="lightning"
            title="Confirmas en segundos"
            body="El banco responde mientras el cliente sigue en el mostrador."
          />
          <Benefit
            icon="users-three"
            title="Cada caja, su código"
            body="Cajeros con PIN; el dueño ve todo desde su panel."
          />
          <Benefit
            icon="seal-check"
            title="Solo lo que el banco confirma"
            body="Ningún cobro se aprueba desde la pantalla."
          />
        </div>

        <div className="auth-stats">
          <Stat value="128" label="comercios" />
          <Stat value="9.412" label="pagos hoy" />
          <Stat value="2,4 s" label="respuesta" />
        </div>
      </aside>
    </>
  );
}

/** One line of the login pitch: an accent icon, a title, a muted sentence. */
function Benefit({ icon, title, body }: { icon: IconName; title: string; body: string }) {
  return (
    <div className="auth-benefit">
      <span className="auth-benefit-mark">
        <Icon name={icon} />
      </span>
      <div>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 14 }}>{title}</div>
        <span className="text-muted" style={{ fontSize: 12 }}>
          {body}
        </span>
      </div>
    </div>
  );
}

/** One figure in the bottom stat row. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="tnum" style={{ fontFamily: 'var(--font-heading)', fontSize: 20 }}>
        {value}
      </div>
      <span className="text-muted" style={{ fontSize: 11 }}>
        {label}
      </span>
    </div>
  );
}

/**
 * One tab: a real radio inside the label, which is what
 * `.seg-opt:has(input:checked)` paints and what lets the pair be walked with
 * the arrow keys.
 */
function DoorTab({
  door,
  current,
  onPick,
  icon,
  label,
}: {
  door: Door;
  current: Door;
  onPick: (door: Door) => void;
  icon: 'storefront' | 'cash-register';
  label: string;
}) {
  return (
    <label className="seg-opt" style={{ flex: 1, justifyContent: 'center' }}>
      <input
        type="radio"
        name="door"
        value={door}
        checked={current === door}
        onChange={() => onPick(door)}
      />
      <Icon name={icon} />
      {label}
    </label>
  );
}

function CompanyForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState(signInCompanyAction, NO_SIGN_IN_ERROR);

  return (
    <form action={action}>
      {next !== null && <input type="hidden" name="next" value={next} />}

      <div className="auth-fields">
        <div className="field">
          <label htmlFor="company-email">Correo</label>
          <input
            className="input"
            id="company-email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="company-password">Contraseña</label>
          <input
            className="input"
            id="company-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 16,
        }}
      >
        {/* The session is always kept: the KV TTL slides on every request and it
            only ends at «Cerrar sesión» (CLAUDE.md §7). So this states the
            behaviour rather than offering a choice the product does not have —
            a control that changed nothing would be worse than none. */}
        <label className="radio">
          <input type="checkbox" checked disabled readOnly />
          <span className="dot" />
          Mantener sesión
          <span className="sr-only">La sesión se mantiene abierta hasta que cierres sesión.</span>
        </label>
        <Link href="/forgot-password" style={{ fontSize: 13 }}>
          ¿Olvidaste tu contraseña?
        </Link>
      </div>

      {state.error !== null && <FormNote tone="error">{state.error}</FormNote>}

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={pending}
        style={{ marginTop: 20, minHeight: 40 }}
      >
        Entrar
        <Icon name="arrow-right" />
      </button>
    </form>
  );
}

function CashierForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState(signInCashierAction, NO_SIGN_IN_ERROR);
  const [slug, setSlug] = useState('');
  const [remember, setRemember] = useState(false);

  // Read after mount, never during render: the server has no localStorage, and
  // a first render that differs between the two is a hydration mismatch.
  useEffect(() => {
    const stored = window.localStorage.getItem(REMEMBERED_SLUG_KEY);
    if (stored !== null && stored !== '') {
      setSlug(stored);
      setRemember(true);
    }
  }, []);

  const changeSlug = (value: string) => {
    setSlug(value);
    if (remember) storeSlug(value);
  };

  const changeRemember = (checked: boolean) => {
    setRemember(checked);
    storeSlug(checked ? slug : '');
  };

  return (
    <form action={action}>
      {next !== null && <input type="hidden" name="next" value={next} />}

      <div className="auth-fields">
        <div className="field">
          <label htmlFor="cashier-slug">Código de empresa</label>
          <input
            className="input"
            id="cashier-slug"
            name="companySlug"
            style={{ letterSpacing: '.06em' }}
            value={slug}
            onChange={(event) => changeSlug(event.target.value)}
            autoComplete="organization"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
        <div className="auth-pair">
          <div className="field">
            <label htmlFor="cashier-username">Usuario</label>
            <input
              className="input"
              id="cashier-username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="cashier-pin">PIN</label>
            <input
              className="input"
              id="cashier-pin"
              name="pin"
              type="password"
              // A numeric keypad: this is typed one-handed with a queue in front.
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              required
            />
          </div>
        </div>
      </div>

      <label className="radio" style={{ marginTop: 16 }}>
        <input
          type="checkbox"
          checked={remember}
          onChange={(event) => changeRemember(event.target.checked)}
        />
        <span className="dot" />
        Recordar el código en esta caja
      </label>

      {state.error !== null && <FormNote tone="error">{state.error}</FormNote>}

      <button
        type="submit"
        className="btn btn-primary btn-block"
        disabled={pending}
        style={{ marginTop: 20, minHeight: 40 }}
      >
        Entrar a caja
        <Icon name="arrow-right" />
      </button>
    </form>
  );
}

/** Writes the code, or forgets it when there is nothing worth remembering. */
function storeSlug(slug: string): void {
  const value = slug.trim();
  if (value === '') window.localStorage.removeItem(REMEMBERED_SLUG_KEY);
  else window.localStorage.setItem(REMEMBERED_SLUG_KEY, value);
}
