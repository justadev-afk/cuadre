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
import { type CSSProperties, useEffect, useRef, useState } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs.tsx';
import { authPanel } from '../_components/auth-shell.tsx';
import { Brand } from '../_components/brand.tsx';
import { Icon, type IconName } from '../_components/icon.tsx';
import { DeviceIdField } from '../_lib/device-id-field.tsx';
import { API } from '../_lib/endpoints.ts';
import { NO_SIGN_IN_ERROR, type SignInState } from '../_lib/sign-in-state.ts';
import { useEndpointAction } from '../_lib/use-endpoint-action.ts';

/**
 * The company code, remembered per device — screen 02's «Recordar el código en
 * esta caja». A till belongs to one shop and the code does not change between
 * shifts, so re-typing it every morning is pure friction. It is not a
 * credential; the username and the PIN are, and neither is ever written here.
 */
const REMEMBERED_SLUG_KEY = 'cuadre.company-slug';

/**
 * Which door was last used, remembered per device. A shop's staff open the same
 * one every day — a cashier is always the cashier — so restoring it saves the
 * first tap and lands the cursor in the right field. It is a preference, not a
 * credential.
 */
const REMEMBERED_DOOR_KEY = 'cuadre.login-door';

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

/** The pitch panel's layered gradient — accent glow top-right over a dusk fade. */
const asideBackground: CSSProperties = {
  background:
    'radial-gradient(120% 80% at 100% 0%, var(--color-accent-900) 0%, transparent 60%), linear-gradient(180deg, var(--color-neutral-900) 0%, var(--color-bg) 100%)',
  boxShadow: 'inset 1px 0 0 var(--border)',
};

export function LoginForm({ next, notice, stats }: LoginFormProps) {
  const [door, setDoor] = useState<Door>('company');

  // Restore the last-used door after mount (never during render: the server has
  // no localStorage, and a differing first render is a hydration mismatch).
  useEffect(() => {
    const stored = window.localStorage.getItem(REMEMBERED_DOOR_KEY);
    if (stored === 'company' || stored === 'cashier') setDoor(stored);
  }, []);

  const changeDoor = (value: Door) => {
    setDoor(value);
    window.localStorage.setItem(REMEMBERED_DOOR_KEY, value);
  };

  return (
    <>
      <div className={authPanel}>
        <Brand size={24} />

        <div className="my-auto flex w-full flex-col gap-4">
          <div>
            <h1 className="font-heading text-xl font-medium leading-tight md:text-[25px]">
              Entrar
            </h1>
            <p className="text-[13px] text-muted-foreground">
              {door === 'company'
                ? 'Elige tu tipo de acceso.'
                : 'Tu empresa te entrega el código y el PIN.'}
            </p>
          </div>

          <Tabs value={door} onValueChange={(value) => changeDoor(value as Door)}>
            <TabsList>
              <TabsTrigger value="company">
                <Icon name="storefront" />
                Empresa
              </TabsTrigger>
              <TabsTrigger value="cashier">
                <Icon name="cash-register" />
                Cajero
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {notice !== null && (
            <Alert>
              <Icon name={notice.tone === 'success' ? 'check-circle' : 'warning-circle'} />
              <AlertDescription>{notice.text}</AlertDescription>
            </Alert>
          )}

          {door === 'company' ? <CompanyForm next={next} /> : <CashierForm next={next} />}
        </div>

        <div className="flex items-center gap-2.5 pt-[18px] text-[11px] text-foreground/45">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-primary" />
            Banesco operativo
          </span>
          <span className="ml-auto">Cuadre · v2</span>
        </div>
      </div>

      <aside
        className="hidden flex-col gap-5 overflow-y-auto px-8 py-9 md:flex"
        style={asideBackground}
      >
        <div className="mt-auto h-0.5 w-[34px] shrink-0 bg-primary" />
        <p className="m-0 font-heading text-[21px] leading-[1.25]">
          {door === 'company'
            ? 'Confirma el pago móvil en el mostrador, sin abrir el estado de cuenta.'
            : 'Confirma el pago móvil antes de entregar la compra.'}
        </p>

        <div className="flex flex-col gap-3.5">
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

        <div className="mt-auto flex gap-[22px] pt-[18px] shadow-[inset_0_1px_0_var(--border)]">
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
    <div className="flex items-start gap-2.5">
      <span className="grid size-[30px] shrink-0 place-items-center rounded-md bg-primary/[0.14] text-base text-primary">
        <Icon name={icon} />
      </span>
      <div>
        <div className="font-heading text-sm">{title}</div>
        <span className="text-xs text-muted-foreground">{body}</span>
      </div>
    </div>
  );
}

/** One figure in the bottom stat row. */
function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-heading text-xl tabular-nums">{value}</div>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function CompanyForm({ next }: { next: string | null }) {
  // `refresh: false` — a sign-in navigates. Re-rendering the login screen it is
  // leaving would only race the redirect the endpoint just handed back.
  const [state, action, pending] = useEndpointAction<SignInState>(
    API.signInCompany,
    NO_SIGN_IN_ERROR,
    { refresh: false },
  );
  // Controlled, so a refused sign-in keeps what was typed: React resets an
  // uncontrolled form once its action returns, which would wipe the fields on
  // the exact error the person needs to correct. The password lives only in
  // client state and is never echoed back through the action.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [remember, setRemember] = useState(true);
  const emailRef = useRef<HTMLInputElement>(null);

  // Land the cursor on the first field the moment this door opens.
  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  // On a refusal, clear only the password and put the cursor back on the email:
  // the email is usually right and the password is what gets re-typed, so this
  // saves re-selecting the field. Fires once per refused submission.
  useEffect(() => {
    if (state.error !== null) {
      setPassword('');
      emailRef.current?.focus();
    }
  }, [state]);

  return (
    <form action={action} className="flex flex-col gap-3">
      {next !== null && <input type="hidden" name="next" value={next} />}
      <DeviceIdField />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-email">Correo</Label>
          <Input
            ref={emailRef}
            id="company-email"
            name="email"
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            className="h-10"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="company-password">Contraseña</Label>
          <div className="relative">
            <Input
              id="company-password"
              name="password"
              type={reveal ? 'text' : 'password'}
              autoComplete="current-password"
              className="h-10 pr-10"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={reveal ? 'Ocultar la contraseña' : 'Mostrar la contraseña'}
              onClick={() => setReveal((value) => !value)}
              className="absolute top-1/2 right-1 size-8 -translate-y-1/2"
            >
              <Icon name="eye" />
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-1 flex items-center justify-between gap-3">
        <Label className="cursor-pointer text-sm text-foreground">
          <Checkbox
            name="remember"
            checked={remember}
            onCheckedChange={(value) => setRemember(value === true)}
          />
          Mantener sesión
        </Label>
        <Link href="/forgot-password" className="text-[13px]">
          ¿Olvidaste tu contraseña?
        </Link>
      </div>

      {state.error !== null && (
        <Alert>
          <Icon name="warning-circle" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="block" className="mt-0.5 h-11" disabled={pending}>
        Entrar
        <Icon
          name={pending ? 'arrows-clockwise' : 'arrow-right'}
          className={pending ? 'animate-spin' : ''}
        />
      </Button>
    </form>
  );
}

function CashierForm({ next }: { next: string | null }) {
  const [state, action, pending] = useEndpointAction<SignInState>(
    API.signInCashier,
    NO_SIGN_IN_ERROR,
    { refresh: false },
  );
  const [slug, setSlug] = useState('');
  // On by default: a till belongs to one shop, so remembering the código is the
  // helpful default — the cashier just types their usuario and PIN each shift.
  const [remember, setRemember] = useState(true);
  // Controlled, so a refused sign-in keeps the code, the username and the PIN
  // rather than clearing them under the error. The PIN never leaves client state.
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const slugRef = useRef<HTMLInputElement>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  // A refused sign-in clears only the PIN and returns the cursor to the usuario,
  // the same courtesy the merchant form does with the email.
  useEffect(() => {
    if (state.error !== null) {
      setPin('');
      usernameRef.current?.focus();
    }
  }, [state]);

  // Read after mount, never during render: the server has no localStorage, and
  // a first render that differs between the two is a hydration mismatch.
  useEffect(() => {
    const stored = window.localStorage.getItem(REMEMBERED_SLUG_KEY);
    if (stored !== null && stored !== '') {
      setSlug(stored);
      setRemember(true);
      // The code is known, so the first empty field is the usuario.
      usernameRef.current?.focus();
    } else {
      slugRef.current?.focus();
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
    <form action={action} className="flex flex-col gap-3">
      {next !== null && <input type="hidden" name="next" value={next} />}
      <DeviceIdField />

      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="cashier-slug">Código de empresa</Label>
          <Input
            ref={slugRef}
            id="cashier-slug"
            name="companySlug"
            className="h-10 tracking-[0.06em]"
            value={slug}
            onChange={(event) => changeSlug(event.target.value)}
            autoComplete="organization"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
        <div className="grid grid-cols-[1.4fr_1fr] gap-3 max-md:grid-cols-1">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cashier-username">Usuario</Label>
            <Input
              ref={usernameRef}
              id="cashier-username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              className="h-10"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cashier-pin">PIN</Label>
            <Input
              id="cashier-pin"
              name="pin"
              type="password"
              // A numeric keypad: this is typed one-handed with a queue in front.
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              className="h-10"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              required
            />
          </div>
        </div>
      </div>

      <Label className="mt-1 cursor-pointer text-sm text-foreground">
        <Checkbox checked={remember} onCheckedChange={(value) => changeRemember(value === true)} />
        Recordar el código en esta caja
      </Label>

      {state.error !== null && (
        <Alert>
          <Icon name="warning-circle" />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <Button type="submit" size="block" className="mt-2 h-11" disabled={pending}>
        Entrar a caja
        <Icon
          name={pending ? 'arrows-clockwise' : 'arrow-right'}
          className={pending ? 'animate-spin' : ''}
        />
      </Button>
    </form>
  );
}

/** Writes the code, or forgets it when there is nothing worth remembering. */
function storeSlug(slug: string): void {
  const value = slug.trim();
  if (value === '') window.localStorage.removeItem(REMEMBERED_SLUG_KEY);
  else window.localStorage.setItem(REMEMBERED_SLUG_KEY, value);
}
