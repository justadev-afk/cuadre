/**
 * The cheap guard at the edge: is there a session cookie at all, and does the
 * path belong to a signed-in area?
 *
 * It deliberately does NOT resolve the session. Reading KV to check a role on
 * every request — including every static asset the matcher lets through —
 * would put a storage round trip in front of the whole app, and the value it
 * would compute is one a page already computes when it calls `currentSession`.
 * So the split is: middleware bounces an anonymous request away from a
 * protected area and a cookie-holder away from the login screen; the page does
 * the authoritative check, because the page is where a stale or forged cookie
 * has to fail closed anyway.
 *
 * It does one thing to every request that carries the cookie: hands it back
 * with a fresh lifetime (`renewedSessionCookie`). That needs no KV read either,
 * and without it the cookie is an absolute expiry set at sign-in.
 *
 * **It lives in `src/`, beside `app/`, or it does not run at all.** vinext, like
 * Next, only looks for it next to the app directory — at the repository root,
 * where it sat until 2026-09-16, it was silently never loaded, and every page
 * guard below it was doing the work alone.
 *
 * `SESSION_COOKIE.name` is imported rather than typed as a literal so the name
 * lives in exactly one place (`application/session.ts`).
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { SESSION_ENDED_PATH } from './app/_lib/session-exit.ts';
import { renewedSessionCookie } from './app/_lib/session-renewal.ts';
import { SESSION_COOKIE } from './application/session.ts';

/** Everything a signed-in user reaches. Anonymous traffic here is redirected. */
const PROTECTED_PREFIXES = [
  '/admin/companies',
  '/admin/banks',
  '/admin/validations',
  '/companies',
  '/employees',
  '/banks',
  '/validations',
  '/checkout',
  '/my-validations',
  '/profile',
];

/** The public routes a cookie-holder is bounced *out* of, back to their area. */
const AUTH_PAGES = ['/login', '/admin/login'];

export function middleware(request: NextRequest): NextResponse {
  const response = route(request);
  const renewed = renewedSessionCookie(
    request.nextUrl.pathname,
    request.cookies.get(SESSION_COOKIE.name)?.value,
  );
  if (renewed !== null) response.headers.append('set-cookie', renewed);
  return response;
}

function route(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  const hasCookie = request.cookies.has(SESSION_COOKIE.name);

  if (
    !hasCookie &&
    PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  ) {
    // Admin paths bounce to the admin login; everyone else to the merchant one.
    // The `next` param lets the login send them back where they were headed.
    const to = pathname.startsWith('/admin') ? '/admin/login' : '/login';
    const url = new URL(to, request.url);
    if (pathname !== to) url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  // A cookie-holder on a login page is sent to `/session-ended`, which resolves
  // the session for real: a live one goes on to its area, anything else has its
  // cookie cleared and lands back here without it. Not `/` — that sends a cookie
  // naming nothing to `/login` *with* the cookie, which bounces straight back,
  // and a cookie this middleware renews on every request would never get out.
  if (hasCookie && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL(SESSION_ENDED_PATH, request.url));
  }

  return NextResponse.next();
}

/**
 * Skip the static asset paths and the manifest — the guard has nothing to say
 * about them and running it there is pure latency.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|icons|favicon.ico|manifest.webmanifest).*)'],
};
