/**
 * `POST /api/shift-ack` — *sigo yo, continuar*, the four-hour prompt's only
 * mutation.
 *
 * It answers a **redirect**, not JSON, because the prompt is deliberately
 * script-free: the shift dialog is a Server Component and both of its answers
 * are plain `<form method="post">` submissions, so a failed hydration bundle can
 * never leave a till stuck behind a modal it cannot dismiss. `/logout` — the
 * other answer — has worked exactly this way all along.
 *
 * The session id comes from the cookie and never from the form: the whole point
 * of the prompt is that whoever is at the till answers for *this* session, and a
 * hidden field carrying an id would be a field somebody can change.
 *
 * Unreachable while `SHIFT_CONFIRMATION_ENABLED` (`domain/shift.ts`) is `false`:
 * nothing renders the prompt that posts here. It stays wired — and harmless, it
 * only stamps the session it already belongs to — so flipping that constant back
 * on restores the whole flow without a route to rebuild.
 */
import { container, currentSession } from '../../_lib/current-session.ts';
import { isLiveSession, signedOutPath } from '../../_lib/session-exit.ts';

export async function POST(request: Request): Promise<Response> {
  const resolution = await currentSession();
  if (!isLiveSession(resolution)) return seeOther(signedOutPath(resolution), request);

  const session = await container().auth.acknowledgeShift({
    sessionId: resolution.active.sessionId,
  });
  // Gone between the render and the click. Nothing to acknowledge.
  if (session === null) return seeOther('/login', request);

  return seeOther(backTo(request), request);
}

/**
 * Where the till was when it was interrupted. The prompt lives in a layout over
 * whatever screen the person was on, so sending them to `/` would answer a
 * question with a navigation.
 *
 * Only a same-origin path is honoured — a `Referer` is a header, and a header is
 * whatever the caller wrote in it.
 */
function backTo(request: Request): string {
  const referer = request.headers.get('referer');
  if (referer === null) return '/';
  try {
    const url = new URL(referer);
    const here = new URL(request.url);
    return url.origin === here.origin ? url.pathname + url.search : '/';
  } catch {
    return '/';
  }
}

/** See Other: the browser follows with a GET, which re-renders without the prompt. */
function seeOther(path: string, request: Request): Response {
  return new Response(null, {
    status: 303,
    headers: { location: new URL(path, request.url).toString() },
  });
}
