/**
 * Ending a session: the record goes, and with it the reverse index that made
 * the user's other devices findable.
 *
 * There is no failure to report. A sign-out for a session KV has already
 * forgotten has arrived at the state it wanted, and telling the caller
 * otherwise would only give them a reason not to clear the cookie.
 */
export type SignOutInput = { readonly sessionId: string };

export type SignOutDeps = {
  readonly sessions: { delete(id: string): Promise<void> };
};

export type SignOut = (input: SignOutInput) => Promise<void>;

export function makeSignOut(deps: SignOutDeps): SignOut {
  // The cookie is the caller's half of this: `expiredSessionCookie()` in
  // `src/application/session.ts` clears the browser's copy in the same
  // response that this call empties the store.
  return ({ sessionId }) => deps.sessions.delete(sessionId);
}
