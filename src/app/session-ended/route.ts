/**
 * `/session-ended` — where a superseded session is sent to be signed out.
 *
 * A superseded cookie (the user signed in elsewhere) still resolves to a
 * parseable record, so the area guards cannot just clear it inline — they
 * redirect here, and this route clears the cookie and forwards to the login
 * screen with the flag that renders the "signed in elsewhere" modal.
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

export async function GET(request: Request): Promise<Response> {
  const resolution = await currentSession();

  // Still active: a forged GET must not end it. Send them home, clear nothing.
  if (resolution.kind === 'active') {
    return seeOther(new URL(landingFor(resolution.active.session.role), request.url), null);
  }

  // Superseded on a *different* device is the only case that earns the modal;
  // a same-device supersession (or a plain anonymous cookie) just goes to login.
  const target =
    resolution.kind === 'superseded' && !resolution.sameDevice
      ? '/login?ended=other-device'
      : '/login';

  return seeOther(new URL(target, request.url), expiredSessionCookie());
}

function seeOther(url: URL, setCookie: string | null): Response {
  const headers: Record<string, string> = { location: url.toString() };
  if (setCookie !== null) headers['set-cookie'] = setCookie;
  // See Other: the browser follows with a GET, cookie already cleared.
  return new Response(null, { status: 303, headers });
}
