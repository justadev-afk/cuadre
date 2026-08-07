/**
 * Sign out. A POST, never a GET — a link somebody can be tricked into following
 * must not end a session, and the header menu and the shift dialog both post
 * here.
 *
 * A route handler rather than a Server Action because it clears a cookie *and*
 * redirects with no state to return: the `Set-Cookie` goes on the redirect
 * response directly, using the serialiser in `application/session.ts` so the
 * cleared cookie matches every attribute of the one that was set.
 */

import { expiredSessionCookie } from '../../application/session.ts';
import { container, currentSession } from '../_lib/current-session.ts';

export async function POST(request: Request): Promise<Response> {
  const resolved = await currentSession();
  if (resolved !== null) {
    // Best-effort: even if the KV delete fails, the cleared cookie below signs
    // the browser out, and the session's own TTL reaps the record.
    await container().auth.signOut({ sessionId: resolved.sessionId });
  }

  return new Response(null, {
    status: 303, // See Other: the browser follows with a GET to the login screen.
    headers: {
      location: new URL('/login', request.url).toString(),
      'set-cookie': expiredSessionCookie(),
    },
  });
}
