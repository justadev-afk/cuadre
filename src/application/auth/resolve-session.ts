/**
 * Who is holding this session id, and does the counter owe us a shift
 * confirmation? Every authenticated request starts here.
 *
 * Reading also renews: the KV TTL slides on each call and nothing sets an
 * absolute lifetime, so a session never expires on its own. In a shop, throwing
 * a cashier out mid-sale — customer waiting, reference already typed — is a
 * worse outcome than the risk a long idle window carries at a supervised till.
 * What re-establishes who is there is the four-hour prompt, not an expiry.
 *
 * It reads the store and nothing else. Whether the user has since been disabled
 * or their company suspended is a database question, and asking it on every
 * request would put a D1 round trip in front of every page for a fact that
 * changes about twice a year; disabling a user ends their live sessions at the
 * moment it happens (`deleteAllForUser`), which is where that cost belongs.
 */
import { needsShiftConfirmation } from '../../domain/shift.ts';
import type { Clock } from '../../shared/clock.ts';
import {
  type ActiveSessionPointer,
  type SessionRecord,
  type StoredSession,
  toSessionRecord,
} from '../session.ts';

export type ResolveSessionInput = { readonly sessionId: string };

export type ResolvedSession = {
  readonly sessionId: string;
  readonly session: SessionRecord;
  /**
   * Four hours since the last acknowledgement. The screen blocks; nothing logs
   * out on its own if nobody answers.
   */
  readonly needsShiftConfirmation: boolean;
};

/**
 * The three states a cookie can resolve to.
 *
 * `superseded` is the new one: the record still parses, but the user has since
 * signed in elsewhere, so the per-user pointer names a different session. It is
 * kept distinct from `anonymous` precisely so the caller can clear the cookie
 * *and* explain why — a deleted record would have collapsed to `anonymous` and
 * signed the user out with no reason given.
 */
export type SessionResolution =
  | { readonly kind: 'active'; readonly active: ResolvedSession }
  | { readonly kind: 'superseded'; readonly sameDevice: boolean }
  | { readonly kind: 'anonymous' };

/** Reads the per-user active-session pointer. `null` means nothing newer exists. */
export type ActiveSessionReader = {
  getActive(userId: string): Promise<ActiveSessionPointer | null>;
};

export type ResolveSessionDeps = {
  /** `touch` is the read that renews the sliding TTL. */
  readonly sessions: { touch(id: string): Promise<StoredSession | null> };
  readonly activeSessions: ActiveSessionReader;
  readonly clock: Clock;
};

export type ResolveSession = (input: ResolveSessionInput) => Promise<SessionResolution>;

export function makeResolveSession(deps: ResolveSessionDeps): ResolveSession {
  return async ({ sessionId }) => {
    const stored = await deps.sessions.touch(sessionId);
    if (stored === null) return { kind: 'anonymous' };

    // A record whose role this build no longer knows is not a session it can
    // reason about, so it is nobody rather than somebody with reduced rights.
    const session = toSessionRecord(stored);
    if (session === null) return { kind: 'anonymous' };

    // The pointer names the one session this user is allowed. A null pointer
    // fails open (nothing newer exists); a pointer naming a *different* session
    // means the user signed in elsewhere and this one is superseded.
    const pointer = await deps.activeSessions.getActive(session.userId);
    if (pointer !== null && pointer.sessionId !== sessionId) {
      return { kind: 'superseded', sameDevice: pointer.deviceId === session.deviceId };
    }

    return {
      kind: 'active',
      active: {
        sessionId,
        session,
        needsShiftConfirmation: needsShiftConfirmation({
          shiftAckAt: session.shiftAckAt,
          now: deps.clock.nowSeconds(),
        }),
      },
    };
  };
}
