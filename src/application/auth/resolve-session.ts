/**
 * Who is holding this session id, and does the counter owe us a shift
 * confirmation? Every authenticated request starts here.
 *
 * Reading also renews: the KV TTL slides on each call and nothing sets an
 * absolute lifetime, so a session never expires on its own. In a shop, throwing
 * a cashier out mid-sale — customer waiting, reference already typed — is a
 * worse outcome than the risk a long idle window carries at a supervised till.
 * What re-establishes who is there is the four-hour prompt, not an expiry —
 * and while `SHIFT_CONFIRMATION_ENABLED` is off, nothing re-establishes it:
 * a session lasts until somebody signs out, signs in elsewhere, or loses the
 * account behind it.
 *
 * **It also asks whether that person still exists.** Ending a user's live
 * sessions when they are deleted (`deleteAllForUser`) is still done at the
 * moment it happens, but it cannot be the only thing standing between a removed
 * cashier and a live till: it is a KV list of a reverse index, and a session
 * whose index key was never written — an older record, a partial write, a list
 * that lagged — survives its own user. That is what happened, on a real deleted
 * cashier who kept validating payments.
 *
 * So the record is now checked against the row it names, on every request. One
 * indexed read that answers both questions at once (is the user still active,
 * is their company still active) is the price, and it is the same D1 the page
 * behind it is about to query anyway. A session whose user is gone, disabled or
 * suspended resolves to `revoked`: the record is deleted on the spot and the
 * caller signs the browser out.
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
  /**
   * The record is fine and nobody signed in elsewhere — the *account* is gone.
   * Deleted, disabled, or its company suspended. Distinct from `anonymous`
   * because it is a live cookie that must be cleared and answered with a 401,
   * not a browser that simply never signed in.
   */
  | { readonly kind: 'revoked' }
  | { readonly kind: 'anonymous' };

/** Reads the per-user active-session pointer. `null` means nothing newer exists. */
export type ActiveSessionReader = {
  getActive(userId: string): Promise<ActiveSessionPointer | null>;
};

/**
 * May this user still be here? Both halves of the answer in one read, because
 * they are asked together on every authenticated request.
 *
 * `status` and `companyStatus` are plain strings, like every other value that
 * comes off a row this build does not control the history of: anything that is
 * not exactly `'active'` fails closed.
 */
export type AccountStanding = {
  readonly status: string;
  /** `null` for a platform admin, who belongs to no company. */
  readonly companyId: string | null;
  /** `null` when there is no company row to read — an admin, or a dangling id. */
  readonly companyStatus: string | null;
};

export type AccountStandingReader = {
  findStanding(userId: string): Promise<AccountStanding | null>;
};

export type ResolveSessionDeps = {
  /** `touch` is the read that renews the sliding TTL; `delete` reaps a revoked one. */
  readonly sessions: {
    touch(id: string): Promise<StoredSession | null>;
    delete(id: string): Promise<void>;
  };
  readonly activeSessions: ActiveSessionReader;
  readonly users: AccountStandingReader;
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

    // Does the person this record names still exist, and are they still allowed
    // in? Asked before the supersession check because it is the stronger fact: a
    // deleted user is not "signed in elsewhere", they are nobody.
    if (!(await standsUp(deps, session.userId))) {
      // The record is worthless from here on, and leaving it to its thirty-day
      // TTL leaves a live credential on the shelf. Deleting it is also what makes
      // the very next request cheap: it resolves as anonymous without a D1 read.
      await deps.sessions.delete(sessionId);
      return { kind: 'revoked' };
    }

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

/**
 * The account behind a session, as this request must read it.
 *
 * Everything fails closed: a row that is not there, a status that is not
 * exactly `'active'`, a user who belongs to a company whose row is missing or
 * not active. The dangling-company case is the subtle one — `companyStatus` is
 * `null` both for a platform admin (no company at all) and for a merchant user
 * whose company row is gone, and only the first of those may stay signed in,
 * which is why `companyId` travels alongside it.
 */
async function standsUp(deps: ResolveSessionDeps, userId: string): Promise<boolean> {
  const standing = await deps.users.findStanding(userId);
  if (standing === null || standing.status !== 'active') return false;
  if (standing.companyId === null) return true;
  return standing.companyStatus === 'active';
}
