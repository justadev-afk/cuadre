/**
 * How a page or a server action learns who is signed in.
 *
 * The Worker's env — the D1 and KV bindings the container needs — reaches this
 * layer through `cloudflare:workers`, which vinext resolves the same way in dev
 * (`wrangler dev`, on-disk D1/KV) and in production. The container is rebuilt
 * per call; that is cheap (see `buildContainer`) and it keeps a bank session
 * from outliving its request.
 *
 * This module reads. It never sets the cookie — only a route handler or a
 * server action can, and login/logout do it explicitly with the serialisers in
 * `application/session.ts`. A Server Component that tried to would throw.
 */
import { env } from 'cloudflare:workers';
import { cookies } from 'next/headers';
import type { SessionResolution } from '../../application/auth/resolve-session.ts';
import { SESSION_COOKIE } from '../../application/session.ts';
import type { Container } from '../../container.ts';
import { buildContainer } from '../../container.ts';
import type { Bindings } from '../../env.ts';

/** The container for this request. */
export function container(): Container {
  return buildContainer(env as unknown as Bindings);
}

/**
 * How this request resolves: `active` with the session, `superseded` (the user
 * signed in elsewhere), or `anonymous`. Resolving renews the sliding TTL on the
 * KV record — reading *is* the keep-alive, which is why there is no separate
 * heartbeat and why the session never expires under an active till.
 */
export async function currentSession(): Promise<SessionResolution> {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE.name)?.value;
  if (!sessionId) return { kind: 'anonymous' };

  return container().auth.resolveSession({ sessionId });
}
