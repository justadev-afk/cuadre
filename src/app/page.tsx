import { redirect } from 'next/navigation';

import { currentSession } from './_lib/current-session.ts';
import { landingFor } from './_lib/landing.ts';
import { isLiveSession, signedOutPath } from './_lib/session-exit.ts';

/**
 * There is no landing page. `/` resolves the session and forwards: a signed-in
 * caller to the screen their role opens at, everyone else to `/login`. This is
 * also where the login pages send a cookie-holder — doing the resolve here, in
 * one place, is what keeps it out of the edge middleware.
 */
export default async function Home() {
  const resolution = await currentSession();
  if (!isLiveSession(resolution)) redirect(signedOutPath(resolution));
  redirect(landingFor(resolution.active.session.role));
}
