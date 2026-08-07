/**
 * Screens 01 and 02 — `/login`, the merchant's and the cashier's door.
 *
 * The page itself is a Server Component: it resolves the session, decides the
 * one-off line above the form, and hands the rest to the tab, which is the only
 * part that needs a browser.
 *
 * `middleware.ts` already bounces a cookie-holder off this route, so the
 * resolve below normally answers `null` for nothing. It stays because the
 * middleware only sees that a cookie *exists* — this is the check that reads
 * the record, and it is what stops a stale cookie from parking somebody on a
 * form they do not need.
 */
import { redirect } from 'next/navigation';

import { AuthSplit } from '../_components/auth-shell.tsx';
import { currentSession } from '../_lib/current-session.ts';
import { queryValue, type SearchParams } from '../_lib/inputs.ts';
import { landingFor } from '../_lib/landing.ts';
import { LoginForm, type LoginNotice } from './login-form.tsx';
import { SessionEndedModal } from './session-ended-modal.tsx';

export const metadata = { title: 'Entrar · Cuadre' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const resolution = await currentSession();
  if (resolution.kind === 'superseded') redirect('/session-ended');
  if (resolution.kind === 'active') redirect(landingFor(resolution.active.session.role));

  // `/session-ended` cleared the cookie before forwarding here, so by now this
  // resolves anonymous and the middleware lets the page render.
  const endedElsewhere = queryValue(params, 'ended') === 'other-device';

  return (
    <AuthSplit>
      <LoginForm next={queryValue(params, 'next')} notice={noticeFor(params)} />
      {endedElsewhere && <SessionEndedModal />}
    </AuthSplit>
  );
}

/**
 * The two ways somebody arrives here on purpose: they just finished a reset, or
 * the app found their cookie pointing at a session that no longer exists.
 * Neither says anything about an account that is not already in their hands.
 */
function noticeFor(params: SearchParams): LoginNotice | null {
  if (queryValue(params, 'reset') === 'ok') {
    return { tone: 'success', text: 'Tu contraseña quedó lista. Entra con ella.' };
  }
  if (queryValue(params, 'expired') === '1') {
    return { tone: 'error', text: 'Tu sesión ya no estaba activa. Entra de nuevo.' };
  }
  return null;
}
