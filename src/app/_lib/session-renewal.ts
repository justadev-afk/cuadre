/**
 * Re-sending the session cookie, so its lifetime slides the way the record's
 * does.
 *
 * A browser forgets a cookie at the `Max-Age` it was last given, whatever KV
 * still holds, so a cookie written only at sign-in is an absolute expiry — and
 * that is exactly how every till signed in on the day production opened was
 * signed out together thirty days later (see `SESSION_MAX_AGE_SECONDS`). So
 * `middleware.ts` hands the cookie back on every request that carries one.
 *
 * It does that without resolving anything. Renewing a cookie whose session is
 * gone costs nothing: the page or endpoint behind it resolves the session for
 * real, and a dead one is sent to `/session-ended`, which clears it. And
 * because the middleware runs on requests an already-open tab makes anyway —
 * the heartbeat's refresh, a navigation, a charge — a till renews itself
 * without having loaded a newer build first.
 *
 * **The exception is a response that writes the cookie itself.** vinext appends
 * the middleware's `Set-Cookie` *after* the handler's, and the browser keeps the
 * last one it reads, so renewing there would undo a sign-out, or put back the
 * old id over a fresh sign-in's. Those routes are listed here, by the constants
 * that name them.
 */
import { sessionCookie } from '../../application/session.ts';
import { API } from './endpoints.ts';
import { SESSION_ENDED_PATH } from './session-exit.ts';

/** Every route whose response sets or clears the session cookie. */
const WRITES_THE_COOKIE: ReadonlySet<string> = new Set([
  API.signInCompany,
  API.signInCashier,
  API.signInAdmin,
  // Spending a reset link signs the browser in (`sessionReply`).
  API.resetPassword,
  '/logout',
  SESSION_ENDED_PATH,
]);

/**
 * Session ids are 64 hex characters (`IdGen.token`). Anything outside the
 * cookie-safe alphabet is not an id this app minted, and echoing it into a
 * header is not something to do on its behalf.
 */
const COOKIE_SAFE = /^[A-Za-z0-9_-]+$/;

/** The `Set-Cookie` that renews this request's session cookie, or `null`. */
export function renewedSessionCookie(
  pathname: string,
  sessionId: string | undefined,
): string | null {
  if (sessionId === undefined || !COOKIE_SAFE.test(sessionId)) return null;
  if (WRITES_THE_COOKIE.has(withoutTrailingSlash(pathname))) return null;
  return sessionCookie(sessionId);
}

function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}
