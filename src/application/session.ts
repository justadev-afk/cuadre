/**
 * What a signed-in request carries, and where each role is allowed to take it.
 *
 * Pure data and pure rules — no KV, no `Date.now()`, no `Set-Cookie` header
 * being written. `src/adapters/kv/session.store.ts` is what persists a record;
 * this file is what the record *is*, so the use cases and the pages agree on it
 * without either of them importing the store.
 */

/**
 * The three roles the schema has. `supervisor` was dropped in migration 0002 —
 * every row it had became a `company` user — so it is not a role this build can
 * act on, and widening this union to keep an old record working would be
 * re-adding a permission tier by accident.
 */
export type Role = 'admin' | 'company' | 'cashier';

export function isRole(value: string): value is Role {
  return value === 'admin' || value === 'company' || value === 'cashier';
}

export type SessionRecord = {
  readonly userId: string;
  readonly role: Role;
  /** `null` only for a platform admin, mirroring `users.company_id`. */
  readonly companyId: string | null;
  readonly name: string;
  /** A cashier has the username; every other role has the email. Never both. */
  readonly username: string | null;
  readonly email: string | null;
  readonly createdAt: number;
  /**
   * Epoch seconds of the last shift acknowledgement. Signing in is the first
   * one, which is why this is never null: somebody just proved who they are.
   */
  readonly shiftAckAt: number;
  /** `hashIp()` output. A raw address is never written here. */
  readonly ipHash: string;
  /**
   * The persistent browser id this session was minted for — a uuid a device
   * keeps in `localStorage`. It agrees with the per-user active-session pointer,
   * which is how "same device re-login" is told apart from "signed in elsewhere"
   * when a session is superseded. Not a credential, not a secret; it only
   * labels a modal.
   */
  readonly deviceId: string;
};

/**
 * The one active session a user is allowed. Written in KV under
 * `user-active-session:<userId>` on every sign-in; read on the resolve path to
 * decide whether the session presenting itself is still the current one. A
 * session whose id no longer matches the pointer has been superseded.
 */
export type ActiveSessionPointer = {
  /** The session id the pointer currently names — the one that still works. */
  readonly sessionId: string;
  /** The device that minted it, for telling a same-device re-login apart. */
  readonly deviceId: string;
  /** Epoch seconds the pointer was written. */
  readonly at: number;
};

/**
 * A record as the store hands it back, before this build has agreed that it
 * understands it.
 *
 * `role` is a plain string on purpose. Sessions never expire on their own, so
 * KV holds records written by deploys older than the migration that dropped
 * `supervisor`, and one carrying a role this build does not know must fail
 * closed rather than be trusted into an area.
 */
export type StoredSession = Omit<SessionRecord, 'role'> & { readonly role: string };

/** `null` when the stored role is not one this build knows. */
export function toSessionRecord(stored: StoredSession): SessionRecord | null {
  return isRole(stored.role) ? { ...stored, role: stored.role } : null;
}

// ── the role guard ─────────────────────────────────────────────────────────

/**
 * The three places the app has. `counter` is the cashier's checkout screen;
 * `company` is the merchant's panel; `admin` is the platform's.
 */
export type Area = 'admin' | 'company' | 'counter';

/**
 * One area each, and the first of the list is where the role lands after
 * signing in.
 *
 * A platform admin deliberately does not reach the company panel: they have no
 * `company_id`, and every query in that panel is scoped by one, so "an admin
 * can see everything" is not a permission this schema can honour without
 * breaking the boundary between merchants. Widening any row is one entry here
 * plus the tests that pin the table — which is exactly the amount of
 * deliberation that decision deserves.
 */
const AREAS_BY_ROLE: Record<Role, readonly [Area, ...Area[]]> = {
  admin: ['admin'],
  // A company owner reaches the counter too: a small merchant is often the one
  // at the till. `company` stays first, so they still land on their panel after
  // signing in — the counter is somewhere they go, not where they start.
  company: ['company', 'counter'],
  cashier: ['counter'],
};

/** May this role reach this area? The one answer; nothing else has an opinion. */
export function canReach(role: Role, area: Area): boolean {
  return AREAS_BY_ROLE[role].includes(area);
}

/** The guard's shape, for a caller that takes one as a parameter. */
export type RoleGuard = typeof canReach;

/**
 * Where a role goes after signing in. It reads the same table as `canReach`, so
 * a redirect cannot send somebody to a screen the guard will bounce them off.
 */
export function homeAreaFor(role: Role): Area {
  return AREAS_BY_ROLE[role][0];
}

// ── the cookie ─────────────────────────────────────────────────────────────

/**
 * Thirty days, matching the idle window the session record's KV TTL slides
 * over. The two have to agree: a cookie that dies first signs out a till whose
 * session is perfectly alive, and one that outlives the record only sends an id
 * KV has already forgotten. The response that renews the record re-sends this
 * cookie, so both slide together.
 */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * `SameSite=Lax` rather than `Strict`: a Strict cookie is withheld on the first
 * navigation in from another origin, which is how somebody arrives after
 * clicking a link in their mail — they would land signed out and sign in again
 * to reach the page they were already entitled to.
 */
export const SESSION_COOKIE = {
  name: 'cuadre_session',
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
  maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
} as const;

export function sessionCookie(sessionId: string): string {
  return `${SESSION_COOKIE.name}=${sessionId}; ${attributes(SESSION_COOKIE.maxAgeSeconds)}`;
}

/**
 * Clearing a cookie means re-sending every attribute that scoped it. A
 * `Set-Cookie` that drops `Path` addresses a *different* cookie from the one
 * that was set, which is to say it deletes nothing and the user stays signed
 * in — so both serialisers share one attribute list.
 */
export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE.name}=; ${attributes(0)}`;
}

function attributes(maxAgeSeconds: number): string {
  return [
    `Max-Age=${maxAgeSeconds}`,
    `Path=${SESSION_COOKIE.path}`,
    'HttpOnly',
    'Secure',
    `SameSite=${SESSION_COOKIE.sameSite}`,
  ].join('; ');
}
