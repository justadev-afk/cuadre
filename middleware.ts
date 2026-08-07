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
 * `SESSION_COOKIE.name` is imported rather than typed as a literal so the name
 * lives in exactly one place (`application/session.ts`).
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { SESSION_COOKIE } from './src/application/session.ts';

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

  // A cookie-holder on a login page is sent to `/`, which resolves the session
  // for real and forwards to the right area. Doing that here would mean reading
  // KV in the middleware; `/` already does it.
  if (hasCookie && AUTH_PAGES.includes(pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
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
