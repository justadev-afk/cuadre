/**
 * The one place that decides where a request goes when it is *not* a live
 * session.
 *
 * There are three ways to not be signed in and they do not share a destination:
 * an anonymous browser belongs on the login screen it was headed for, while a
 * cookie that still names something — superseded by a newer sign-in, or revoked
 * because the account behind it is gone — has to be **cleared** first, which is
 * `/session-ended`'s job. Nine screens made that decision inline and each one
 * knew about two of the three states; adding the third to nine files, correctly,
 * is not a thing that happens twice in a row.
 *
 * `isLiveSession` is a type predicate so a caller keeps the narrowing it had:
 * `if (!isLiveSession(resolution)) redirect(...)` leaves `resolution.active`
 * reachable below, the same way the hand-written pair of `kind ===` checks did.
 */
import type { SessionResolution } from '../../application/auth/resolve-session.ts';

/** A resolution that carries a session. The only one with `.active` on it. */
export type LiveSession = Extract<SessionResolution, { readonly kind: 'active' }>;

/** Everything else: nobody, somebody newer, or somebody who no longer exists. */
export type SignedOut = Exclude<SessionResolution, LiveSession>;

export function isLiveSession(resolution: SessionResolution): resolution is LiveSession {
  return resolution.kind === 'active';
}

/**
 * Where a cookie that clears itself goes. It re-resolves there and refuses to
 * clear a session that turns out to be live, so a forged link to it is inert.
 */
export const SESSION_ENDED_PATH = '/session-ended';

/**
 * The destination for a resolution that is not a session.
 *
 * `login` is the door of the area being guarded — the platform team signs in on
 * its own route — and is used only for a browser that never had a session. The
 * other two states carry a cookie that must be cleared before any login screen
 * will render, so they go through `/session-ended` whichever area asked.
 */
export function signedOutPath(resolution: SignedOut, login = '/login'): string {
  return resolution.kind === 'anonymous' ? login : SESSION_ENDED_PATH;
}
