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
import { DeviceIdField } from '../_lib/device-id-field.tsx';
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

/** One figure in the pitch panel's bottom row — value already formatted. */
export type LoginStatView = { readonly value: string; readonly label: string };

type LoginFormProps = {
  /** The path the middleware bounced them off, if any. */
  readonly next: string | null;
  /** A one-off line above the form: a finished reset, a session that ended. */
  readonly notice: LoginNotice | null;
  /** The real, server-computed figures for the pitch panel. */
  readonly stats: readonly LoginStatView[];
};

export function LoginForm({ next, notice, stats }: LoginFormProps) {
  const [door, setDoor] = useState<Door>('company');

  return (
    <>
      <div className="auth-panel">
        <Brand size={24} />

        <div className="auth-form">
          <div>
            <h1 className="auth-title">Entrar</h1>
            <p className="text-muted" style={{ fontSize: 13 }}>
              {door === 'company'
                ? 'Elige tu tipo de acceso.'
                : 'Tu empresa te entrega el código y el PIN.'}
            </p>
          </div>

          <div className="seg" style={{ width: '100%' }}>
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

        <div className="auth-foot">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--color-accent)',
              }}
            />
            Banesco operativo
          </span>
          <span style={{ marginLeft: 'auto' }}>Cuadre · v2</span>
        </div>
      </div>

      <aside className="auth-aside">
        <div className="auth-aside-rule" />
        <p className="auth-aside-quote">
          {door === 'company'
            ? 'Confirma el pago móvil en el mostrador, sin abrir el estado de cuenta.'
            : 'Confirma el pago móvil antes de entregar la compra.'}
        </p>

        <div className="auth-benefits">
          <Benefit
            icon="lightning"
            title="Respuesta en segundos"
            body="Consulta directa a Banesco con la referencia del cliente."
          />
          <Benefit
            icon="users-three"
            title="Cada cajero con su usuario"
            body="Sabes quién validó cada cobro y a qué hora."
          />
          <Benefit
            icon="seal-check"
            title="Código de control"
            body="Seis dígitos para anotar en el recibo."
          />
        </div>

        <div className="auth-stats">
          {stats.map((stat) => (
            <Stat key={stat.label} value={stat.value} label={stat.label} />
          ))}
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
  // Controlled, so a refused sign-in keeps what was typed: React resets an
  // uncontrolled form once its action returns, which would wipe the fields on
  // the exact error the person needs to correct. The password lives only in
  // client state and is never echoed back through the action.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(true);

  return (
    <form action={action}>
      {next !== null && <input type="hidden" name="next" value={next} />}
      <DeviceIdField />

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
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="company-password">Contraseña</label>
          <div style={{ position: 'relative' }}>
            <input
              className="input"
              id="company-password"
              name="password"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              style={{ paddingRight: 40 }}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              aria-label={reveal ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
              onClick={() => setReveal((value) => !value)}
              style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)' }}
            >
              <Icon name="eye" />
            </button>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginTop: 4,
        }}
      >
        <label className="radio">
          <input
            type="checkbox"
            name="remember"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
          />
          <span className="dot" />
          Mantener sesión
        </label>
        <Link href="/forgot-password" style={{ fontSize: 13 }}>
          ¿Olvidaste tu contraseña?
        </Link>
      </div>

      {state.error !== null && <FormNote tone="error">{state.error}</FormNote>}

      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
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
  // Controlled, so a refused sign-in keeps the code, the username and the PIN
  // rather than clearing them under the error. The PIN never leaves client state.
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');

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
      <DeviceIdField />

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
              value={username}
              onChange={(event) => setUsername(event.target.value)}
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
              value={pin}
              onChange={(event) => setPin(event.target.value)}
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
