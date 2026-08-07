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
import { type SessionRecord, type StoredSession, toSessionRecord } from '../session.ts';

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

export type ResolveSessionDeps = {
  /** `touch` is the read that renews the sliding TTL. */
  readonly sessions: { touch(id: string): Promise<StoredSession | null> };
  readonly clock: Clock;
};

export type ResolveSession = (input: ResolveSessionInput) => Promise<ResolvedSession | null>;

export function makeResolveSession(deps: ResolveSessionDeps): ResolveSession {
  return async ({ sessionId }) => {
    const stored = await deps.sessions.touch(sessionId);
    if (stored === null) return null;

    // A record whose role this build no longer knows is not a session it can
    // reason about, so it is nobody rather than somebody with reduced rights.
    const session = toSessionRecord(stored);
    if (session === null) return null;

    return {
      sessionId,
      session,
      needsShiftConfirmation: needsShiftConfirmation({
        shiftAckAt: session.shiftAckAt,
        now: deps.clock.nowSeconds(),
      }),
    };
  };
}
