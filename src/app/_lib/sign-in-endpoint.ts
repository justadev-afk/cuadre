/**
 * The body the three sign-in endpoints share.
 *
 * Three doors — merchant, cashier, platform team — and every one of them has to
 * behave identically for credentials that do not exist, which is why the flow is
 * written once (`application/auth/sign-in.ts` makes the same argument one layer
 * down). What differs is the fields the form carries and the copy for a refusal;
 * both arrive as parameters.
 *
 * The reply is `{ error }` on refusal and `{ redirect }` on success, with the
 * cookie on the response itself. A route handler can send that header, which a
 * Server Action could not — it had to go through `cookies()`. The larger reason
 * for the move is plainer: a sign-in that hangs is a person who cannot work.
 */

import type { SignedIn, SignInFailure } from '../../application/auth/sign-in.ts';
import { sessionCookie } from '../../application/session.ts';
import type { Result } from '../../shared/result.ts';
import { jsonResponse } from './api-guard.ts';
import { type SignInDoor, signInMessage } from './sign-in-state.ts';

/** What a sign-in answers: the error the form renders, or where to go next. */
export function signInReply(
  door: SignInDoor,
  result: Result<SignedIn, SignInFailure>,
  destination: (signedIn: SignedIn) => string,
): Response {
  if (!result.ok) return jsonResponse({ error: signInMessage(door, result.error) });

  return sessionReply(result.value, destination(result.value));
}

/**
 * The answer that hands a browser a session: the cookie, and where to go with
 * it.
 *
 * Two things open one — the three doors above, and spending a password-reset
 * link, which proves ownership of the address without a password ever being
 * typed. Both end here, so the `Set-Cookie` this app writes on a success is
 * written in exactly one place.
 */
export function sessionReply(signedIn: SignedIn, destination: string): Response {
  return new Response(JSON.stringify({ ok: true, error: null, redirect: destination }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      // The serialiser in `application/session.ts`, so the cookie that is set
      // here matches, attribute for attribute, the one `/logout` clears.
      'set-cookie': sessionCookie(signedIn.sessionId),
    },
  });
}
