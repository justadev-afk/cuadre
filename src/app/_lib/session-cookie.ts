/**
 * Writing and clearing the session cookie from a Server Action.
 *
 * A route handler can send the `Set-Cookie` string that
 * `application/session.ts` serialises; a Server Action cannot — it has no
 * response to attach a header to, only `cookies()`. So this is the one place
 * that turns `SESSION_COOKIE` into the object `cookies().set` takes, and it
 * reads every attribute off that constant rather than restating any of them.
 * Two spellings of `Path` or `SameSite` in this codebase is one cookie that
 * cannot be cleared by the code that set it.
 */
import { cookies } from 'next/headers';

import { SESSION_COOKIE } from '../../application/session.ts';

/**
 * `Set-Cookie` spells the attribute `Lax`; `cookies()` takes it lower case. A
 * table rather than a cast, so changing `SESSION_COOKIE.sameSite` to `Strict`
 * still compiles into the right value instead of silently through an assertion.
 */
const SAME_SITE = { Lax: 'lax', Strict: 'strict', None: 'none' } as const;

export async function setSessionCookie(sessionId: string): Promise<void> {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE.name,
    value: sessionId,
    path: SESSION_COOKIE.path,
    httpOnly: SESSION_COOKIE.httpOnly,
    secure: SESSION_COOKIE.secure,
    sameSite: SAME_SITE[SESSION_COOKIE.sameSite],
    maxAge: SESSION_COOKIE.maxAgeSeconds,
  });
}

/**
 * Clearing re-sends every attribute that scoped the cookie, for the reason
 * `expiredSessionCookie()` gives: a deletion that drops `Path` addresses a
 * different cookie from the one that was set, which is to say it deletes
 * nothing and the person stays signed in.
 */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set({
    name: SESSION_COOKIE.name,
    value: '',
    path: SESSION_COOKIE.path,
    httpOnly: SESSION_COOKIE.httpOnly,
    secure: SESSION_COOKIE.secure,
    sameSite: SAME_SITE[SESSION_COOKIE.sameSite],
    maxAge: 0,
  });
}

/** The id in the caller's cookie, or `null`. It is not resolved here. */
export async function sessionIdFromCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(SESSION_COOKIE.name)?.value ?? null;
}
