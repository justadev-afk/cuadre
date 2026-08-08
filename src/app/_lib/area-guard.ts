/**
 * The authoritative role check, run by the layout of every signed-in area.
 *
 * `middleware.ts` bounces an anonymous request before it costs a render, but it
 * deliberately does not resolve the session — so a forged or stale cookie only
 * fails here, where the record is actually read. That is why every area layout
 * calls this and not the other way around.
 *
 * `sessionOnce` wraps `currentSession` in React's per-request `cache`, so the
 * layout that guards, the nested layout that draws the header and the page that
 * needs the company id all share one KV round trip instead of three.
 */
import { redirect } from 'next/navigation';
import { cache } from 'react';

import type { ResolvedSession } from '../../application/auth/resolve-session.ts';
import { type Area, canReach, homeAreaFor } from '../../application/session.ts';
import { currentSession } from './current-session.ts';

/**
 * The path each area opens at — the one screen a role lands on. It lives here,
 * beside the guard that redirects to it, so a sign-in cannot deposit somebody
 * where the guard would bounce them straight back out of. `landing.ts` reads
 * this table rather than restating it.
 */
export const AREA_HOME: Record<Area, string> = {
  admin: '/admin/companies',
  company: '/validations',
  // The counter's server home is `/checkout` (the shell), where a browser tab
  // belongs. The installed PWA lives on the sidebar-less `/checkout-express`,
  // reached by its manifest `start_url` and — as a safety net for a stale cached
  // manifest — by `StandaloneRedirect`, which forwards a standalone app there
  // from `/checkout`. Landing everyone on `/checkout` keeps the failure mode
  // safe: an uncertain "am I a PWA?" reading leaves a browser tab on the shell
  // rather than exiling it to the express till.
  counter: '/checkout',
};

/** The platform team signs in on its own route; merchants share the other. */
const LOGIN_PATH: Record<Area, string> = {
  admin: '/admin/login',
  company: '/login',
  counter: '/login',
};

/**
 * Where a superseded cookie goes to be signed out — the same route for every
 * area, because it clears the cookie and re-resolves rather than trusting the
 * caller's area. It forwards to the login screen that renders the modal.
 */
const SESSION_ENDED_PATH = '/session-ended';

/** One resolve per request, however many layouts and pages ask for it. */
export const sessionOnce = cache(currentSession);

/**
 * The session, or a redirect. No session goes to the area's login; a session
 * whose role may not reach the area goes to that role's own landing screen
 * rather than to an error page — there is nothing for them to decide, they
 * simply live elsewhere.
 */
export async function requireArea(area: Area): Promise<ResolvedSession> {
  const resolution = await sessionOnce();
  if (resolution.kind === 'anonymous') redirect(LOGIN_PATH[area]);
  // A superseded cookie is not signed out inline: `/session-ended` clears it and
  // sends them to the login screen with the "signed in elsewhere" explanation.
  if (resolution.kind === 'superseded') redirect(SESSION_ENDED_PATH);

  const { active } = resolution;
  if (!canReach(active.session.role, area)) {
    redirect(AREA_HOME[homeAreaFor(active.session.role)]);
  }
  return active;
}

/**
 * The company area's guard. Every query below it is scoped by this id and by
 * nothing the client sent, which is the boundary between merchants.
 *
 * `companyId` is null only for a platform admin, and `canReach` has already
 * refused one — but the type says `string | null`, so the impossible case signs
 * out rather than being asserted away.
 */
export async function requireCompany(): Promise<{
  readonly resolved: ResolvedSession;
  readonly companyId: string;
}> {
  const resolved = await requireArea('company');
  const companyId = resolved.session.companyId;
  if (companyId === null) redirect('/login');
  return { resolved, companyId };
}
