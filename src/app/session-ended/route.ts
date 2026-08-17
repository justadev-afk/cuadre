/**
 * `/session-ended` — where a cookie that still names something is sent to be
 * signed out.
 *
 * Two kinds arrive. A **superseded** one (the user signed in elsewhere) and a
 * **revoked** one (the account behind it was deleted, disabled or suspended).
 * Both still resolve to a parseable record, so the area guards cannot clear
 * them inline — they redirect here, and this route clears the cookie and
 * forwards to the login screen with the flag that explains which it was.
 *
 * A GET that clears a cookie is normally something to avoid — a forged link
 * would sign a user out. It is safe here because it re-resolves first and
 * refuses to clear a session that is still active: the worst a forged GET can
 * do to a live user is redirect them to their own landing screen, touching
 * nothing. Only a genuinely superseded or anonymous cookie is cleared.
 */

import { expiredSessionCookie } from '../../application/session.ts';
import { currentSession } from '../_lib/current-session.ts';
import { landingFor } from '../_lib/landing.ts';
import type { SignedOut } from '../_lib/session-exit.ts';

export async function GET(request: Request): Promise<Response> {
  const resolution = await currentSession();

  // Still active: a forged GET must not end it. Send them home, clear nothing.
  if (resolution.kind === 'active') {
    return seeOther(new URL(landingFor(resolution.active.session.role), request.url), null);
  }

  return seeOther(new URL(loginTargetFor(resolution), request.url), expiredSessionCookie());
}

/**
 * Which login screen they land on, and what it says.
 *
 * Superseded on a *different* device is the only case that earns the modal; a
 * same-device supersession just goes to login, because the person is looking at
 * the tab that took over. A **revoked** session gets the "ya no estaba activa"
 * line — true, and it says nothing about the account to whoever is holding the
 * browser: a deleted cashier's device must not be told it was deleted.
 */
function loginTargetFor(resolution: SignedOut): string {
  if (resolution.kind === 'revoked') return '/login?expired=1';
  if (resolution.kind === 'superseded' && !resolution.sameDevice) {
    return '/login?ended=other-device';
  }
  return '/login';
}

function seeOther(url: URL, setCookie: string | null): Response {
  const headers: Record<string, string> = { location: url.toString() };
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  // See Other: the browser follows with a GET, cookie already cleared.
  return new Response(null, { status: 303, headers });
}
