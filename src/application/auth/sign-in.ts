/**
 * The body the three sign-in use cases share. Not a use case itself — it
 * exports no `makeX`.
 *
 * A platform admin, a merchant administrator and a cashier come through three
 * different doors, and every one of those doors has to behave identically for
 * an address or a username that does not exist. Writing the flow once is what
 * makes that true: three copies drift, and the first thing a drifted copy leaks
 * is which kind of account an email belongs to.
 */
import type { Clock } from '../../shared/clock.ts';
import type { IdGen } from '../../shared/id.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { ActiveSessionPointer, Role, SessionRecord } from '../session.ts';
import { normaliseEmail } from './email.ts';

/**
 * `invalid_credentials` covers "no such account" and "wrong password"
 * together, on purpose and at the same cost — see `verifyAgainstDummy`. The
 * other three are only reachable *after* a password has already been proven, so
 * naming them tells the person nothing they did not just demonstrate they knew.
 */
export type SignInFailure =
  | 'invalid_credentials'
  | 'rate_limited'
  | 'account_disabled'
  | 'company_suspended';

export type SignedIn = {
  /** Freshly minted. Never a session id that has been used before. */
  readonly sessionId: string;
  readonly session: SessionRecord;
};

// ── the ports a sign-in consumes ───────────────────────────────────────────

/**
 * What a login needs off a user row. It carries the hash, which is why it is
 * not the same shape the rest of the app passes around.
 *
 * `role` and `status` are strings rather than unions of our own literals
 * because they come out of a database this build does not control the history
 * of: an unrecognised value has to fall through to a refusal here, not fail to
 * compile in a repository somewhere.
 */
export type AuthenticatingUser = {
  readonly id: string;
  readonly companyId: string | null;
  readonly role: string;
  readonly name: string;
  readonly email: string | null;
  readonly username: string | null;
  readonly status: string;
  readonly passwordHash: string;
};

export type SessionWriter = {
  put(id: string, record: SessionRecord): Promise<void>;
};

export type LastLoginWriter = {
  touchLastLogin(id: string, at: number): Promise<void>;
};

/**
 * The per-user "one active session" pointer. Sign-in writes it so a later
 * request on a different device can discover its own session was superseded.
 * It is a write here and a read on the resolve path; the two never race for the
 * same key beyond last-writer-wins, which is exactly the semantics we want —
 * the last device to sign in is the one that keeps the session.
 */
export type ActiveSessionWriter = {
  setActive(userId: string, pointer: ActiveSessionPointer): Promise<void>;
};

/** Only the status matters here. Whether the company exists is a data question. */
export type CompanyStatusReader = {
  findById(id: string): Promise<{ readonly status: string } | null>;
};

/**
 * PBKDF2 as a port rather than a direct call into `src/shared/crypto.ts`. The
 * timing equalisation below is a claim about *what gets hashed*, and a test can
 * only hold us to it if it can see the calls.
 */
export type PasswordVerifier = {
  verify(plaintext: string, storedHash: string): Promise<boolean>;
};

export type RateLimitPolicy = {
  readonly limit: number;
  readonly windowSeconds: number;
};

/** The counter is a counter; the numbers below are the product's, not its. */
export type LoginRateLimiter = {
  hit(scope: string, key: string, policy: RateLimitPolicy): Promise<{ readonly allowed: boolean }>;
  reset(scope: string, key: string, policy: RateLimitPolicy): Promise<void>;
};

export type PasswordSignInDeps = {
  readonly users: {
    findByEmail(email: string): Promise<AuthenticatingUser | null>;
  } & LastLoginWriter;
  readonly companies: CompanyStatusReader;
  readonly sessions: SessionWriter;
  readonly activeSessions: ActiveSessionWriter;
  readonly limiter: LoginRateLimiter;
  readonly passwords: PasswordVerifier;
  readonly clock: Clock;
  readonly ids: IdGen;
};

export type PasswordSignInInput = {
  readonly email: string;
  readonly password: string;
  /** `hashIp()` output. The use case never sees an address. */
  readonly ipHash: string;
  /**
   * The persistent browser id, off a hidden form field. Empty is tolerated (a
   * form submitted before the mount effect wrote it) — supersession still fires
   * in the safe direction; only the same-device labelling degrades.
   */
  readonly deviceId: string;
};

// ── the limits ─────────────────────────────────────────────────────────────

const HOUR = 60 * 60;

export const LOGIN_BY_IP_SCOPE = 'login-ip';
export const LOGIN_BY_EMAIL_SCOPE = 'login-email';

/**
 * Deliberately loose. A shop is one address and every till behind it shares it,
 * so a tight number here locks out the honest counter during a busy afternoon
 * and barely inconveniences somebody working from a pool of addresses.
 */
export const LOGIN_BY_IP: RateLimitPolicy = { limit: 30, windowSeconds: HOUR };

/**
 * Keyed by the address that was typed, not by the user it resolved to — an
 * address nobody has registered has to be counted exactly like one that is, or
 * the limiter itself becomes the oracle the dummy hash exists to close.
 */
export const LOGIN_BY_EMAIL: RateLimitPolicy = { limit: 10, windowSeconds: HOUR };

/**
 * A syntactically valid PBKDF2 hash of nothing anybody knows. It is verified
 * against when the account does not exist so that "no such user" costs the same
 * 100 000 iterations as "wrong password"; without it, a stranger can tell our
 * customer list apart from everyone else with a stopwatch.
 *
 * The iteration count must track `PBKDF2_ITERATIONS` in `src/shared/crypto.ts`.
 * If that cost is raised and this string is not, the equalisation quietly stops
 * equalising.
 */
export const DUMMY_PASSWORD_HASH =
  'pbkdf2$100000$PAlpdMcmFass19AoDKzBGg==$9GZCEQrmKDF3gvpEAv9rnANFd4IXaFbZ5z82+g8o594=';

/**
 * Runs the verification whether or not there is a user, and answers only
 * "these credentials are good". The absent-user branch is the whole point:
 * returning early would make the response time say what the response body
 * refuses to.
 */
export async function verifyAgainstDummy(
  passwords: PasswordVerifier,
  secret: string,
  user: AuthenticatingUser | null,
): Promise<boolean> {
  const verified = await passwords.verify(secret, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
  return user !== null && verified;
}

// ── the shared flow ────────────────────────────────────────────────────────

/** The roles that sign in with an email and a password. A cashier does not. */
export type PasswordRole = Extract<Role, 'admin' | 'company'>;

export async function signInWithPassword(
  deps: PasswordSignInDeps,
  expectedRole: PasswordRole,
  input: PasswordSignInInput,
): Promise<Result<SignedIn, SignInFailure>> {
  const email = normaliseEmail(input.email);

  const byIp = await deps.limiter.hit(LOGIN_BY_IP_SCOPE, input.ipHash, LOGIN_BY_IP);
  if (!byIp.allowed) return err('rate_limited');

  const byEmail = await deps.limiter.hit(LOGIN_BY_EMAIL_SCOPE, email, LOGIN_BY_EMAIL);
  if (!byEmail.allowed) return err('rate_limited');

  const user = await deps.users.findByEmail(email);
  const verified = await verifyAgainstDummy(deps.passwords, input.password, user);
  if (user === null || !verified) return err('invalid_credentials');

  // The wrong door is not a hint. An admin typing into the merchant login is
  // told exactly what a stranger is told, or the two forms together enumerate
  // which addresses belong to the platform team.
  if (user.role !== expectedRole) return err('invalid_credentials');
  if (user.status !== 'active') return err('account_disabled');

  const refusal = await refuseSuspendedCompany(deps.companies, user, expectedRole);
  if (refusal !== null) return err(refusal);

  // The attempts that failed before the right password arrived must not stand
  // against the person who got it right. The by-IP counter is left alone: a
  // shop is one address, and clearing it on any success would hand an attacker
  // sharing that address a fresh window for free.
  await deps.limiter.reset(LOGIN_BY_EMAIL_SCOPE, email, LOGIN_BY_EMAIL);

  return ok(await openSession(deps, user, expectedRole, input.ipHash, input.deviceId));
}

/**
 * A merchant user whose company is suspended is refused at the door rather than
 * shown a panel with nothing in it. A platform admin has no company and skips
 * this entirely.
 *
 * A `company` row with no `company_id` is forbidden by a CHECK constraint, so
 * it cannot happen — and if it ever does, it is a user with no tenant, which is
 * the one thing that must never reach a company-scoped query.
 */
async function refuseSuspendedCompany(
  companies: CompanyStatusReader,
  user: AuthenticatingUser,
  expectedRole: PasswordRole,
): Promise<SignInFailure | null> {
  if (user.companyId === null) {
    return expectedRole === 'admin' ? null : 'invalid_credentials';
  }

  const company = await companies.findById(user.companyId);
  return company !== null && company.status === 'active' ? null : 'company_suspended';
}

/**
 * Mints the session. The id is new on every sign-in, never the one the caller
 * arrived with: a session id captured over someone's shoulder must not survive
 * the next login, and rotating here is what makes fixing one impossible.
 */
export async function openSession(
  deps: {
    readonly sessions: SessionWriter;
    readonly users: LastLoginWriter;
    readonly activeSessions: ActiveSessionWriter;
    readonly clock: Clock;
    readonly ids: IdGen;
  },
  user: AuthenticatingUser,
  role: Role,
  ipHash: string,
  deviceId: string,
): Promise<SignedIn> {
  const now = deps.clock.nowSeconds();
  const sessionId = deps.ids.token();

  const session: SessionRecord = {
    userId: user.id,
    role,
    companyId: user.companyId,
    name: user.name,
    username: user.username,
    email: user.email,
    createdAt: now,
    // Signing in *is* an acknowledgement of the shift: somebody has this
    // second proved who is at the till. Starting the four hours anywhere else
    // would greet them with the prompt they just answered.
    shiftAckAt: now,
    ipHash,
    deviceId,
  };

  await deps.sessions.put(sessionId, session);
  await deps.users.touchLastLogin(user.id, now);

  // This becomes the user's one active session. Any session they had open on
  // another device is now superseded — not deleted here, but no longer named
  // by the pointer, so the resolve path stops honouring it and can say why.
  await deps.activeSessions.setActive(user.id, { sessionId, deviceId, at: now });

  // The session id is a live credential and never reaches a log line.
  logger.info('signed_in', { userId: user.id, role, companyId: user.companyId });

  return { sessionId, session };
}
