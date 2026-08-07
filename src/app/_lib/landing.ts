/**
 * Where a sign-in sends the caller, and whether the `next` they arrived with is
 * somewhere their role is allowed to go.
 *
 * `application/session.ts` owns the areas and the guard, `_lib/area-guard.ts`
 * owns the path each area opens at, and this file owns the one question neither
 * of them answers: a redirect target that came off a query string is a redirect
 * target a stranger wrote.
 */
import { type Area, canReach, homeAreaFor, type Role } from '../../application/session.ts';
import { AREA_HOME } from './area-guard.ts';

/**
 * The screen a role lands on. It reads the same table the area guard redirects
 * to, so a sign-in cannot deposit somebody where the guard bounces them back
 * out of.
 */
export function landingFor(role: Role): string {
  return AREA_HOME[homeAreaFor(role)];
}

/**
 * The prefixes `middleware.ts` protects, each mapped to the area it belongs to.
 * A path that matches nothing here is not classified and therefore not honoured
 * as a destination — falling back to the landing screen is always safe, and
 * guessing an area for an unknown path is how a redirect ends up somewhere the
 * guard bounces it straight back out of.
 *
 * Ordered longest-prefix-first so `/admin/...` cannot be read as the merchant's
 * `/validations` or `/banks`.
 */
const AREA_BY_PREFIX: readonly (readonly [string, Area])[] = [
  ['/admin', 'admin'],
  ['/my-validations', 'counter'],
  ['/checkout', 'counter'],
  ['/validations', 'company'],
  ['/companies', 'company'],
  ['/employees', 'company'],
  ['/banks', 'company'],
];

/** The two public routes a signed-in caller must never be sent back to. */
const AUTH_PAGES = ['/login', '/admin/login'];

/**
 * The destination after a successful sign-in.
 *
 * `next` comes off the query string, which means it is whatever a stranger put
 * there. It is honoured only when it is a same-origin absolute path *and* the
 * new role can reach the area it belongs to — so the redirect cannot be pointed
 * at another site, and it cannot be used to discover which screens exist by
 * watching where the app agrees to go.
 */
export function destinationAfterSignIn(role: Role, next: string | null): string {
  const landing = landingFor(role);
  if (next === null) return landing;

  const area = areaOf(next);
  if (area === null || !canReach(role, area)) return landing;
  return next;
}

function areaOf(next: string): Area | null {
  // A path, not a URL: one leading slash and nothing that a browser would read
  // as a host ('//evil.example') or as a scheme-relative escape ('/\evil').
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  if (next.includes('\n') || next.includes('\r')) return null;

  const path = next.split(/[?#]/)[0] ?? '';
  if (AUTH_PAGES.includes(path)) return null;

  const match = AREA_BY_PREFIX.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return match?.[1] ?? null;
}
