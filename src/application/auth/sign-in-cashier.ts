/**
 * The counter's door: the company slug, a username and a PIN.
 *
 * The lookup tuple is `(company_id, username)` and `company_id` *is* the slug
 * the cashier typed — there is no company lookup standing between the two, and
 * no query on this path that is not already scoped by it.
 *
 * A four-digit PIN has ten thousand values. What makes that defensible is not
 * the hash, it is `MAX_PIN_ATTEMPTS_PER_HOUR`: at five an hour the keyspace
 * takes about a century, and the cashier gets a credential they can enter
 * one-handed with a queue in front of them. Loosen the cap or shorten the PIN
 * and that trade collapses — they are a pair.
 */

import { normaliseSlug } from '../../domain/company.ts';
import { isValidUsername, MAX_PIN_ATTEMPTS_PER_HOUR } from '../../domain/credentials.ts';
import type { Clock } from '../../shared/clock.ts';
import type { IdGen } from '../../shared/id.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import {
  type ActiveSessionWriter,
  type AuthenticatingUser,
  type CompanyStatusReader,
  type LastLoginWriter,
  LOGIN_BY_IP,
  LOGIN_BY_IP_SCOPE,
  type LoginRateLimiter,
  openSession,
  type PasswordVerifier,
  type RateLimitPolicy,
  type SessionWriter,
  type SignedIn,
  type SignInFailure,
  verifyAgainstDummy,
} from './sign-in.ts';

export type SignInCashierInput = {
  /** What was typed into the first field: 'la-espiga', or 'La Espiga'. */
  readonly companySlug: string;
  readonly username: string;
  readonly pin: string;
  /** `hashIp()` output. The use case never sees an address. */
  readonly ipHash: string;
  /** The persistent browser id, off a hidden form field. See `PasswordSignInInput`. */
  readonly deviceId: string;
};

export type SignInCashierDeps = {
  readonly users: {
    findByCompanyAndUsername(
      companyId: string,
      username: string,
    ): Promise<AuthenticatingUser | null>;
  } & LastLoginWriter;
  readonly companies: CompanyStatusReader;
  readonly sessions: SessionWriter;
  readonly activeSessions: ActiveSessionWriter;
  readonly limiter: LoginRateLimiter;
  readonly passwords: PasswordVerifier;
  readonly clock: Clock;
  readonly ids: IdGen;
};

export type SignInCashier = (input: SignInCashierInput) => Promise<Result<SignedIn, SignInFailure>>;

export const PIN_SCOPE = 'pin';

/**
 * The domain owns the number and the reason for it; the window it is stated
 * over is the hour its name promises.
 */
export const PIN_ATTEMPTS: RateLimitPolicy = {
  limit: MAX_PIN_ATTEMPTS_PER_HOUR,
  windowSeconds: 60 * 60,
};

export function makeSignInCashier(deps: SignInCashierDeps): SignInCashier {
  return async (input) => {
    // The slug is normalised, never taken as typed: 'La Espiga' and
    // 'la-espiga' are the same shop to the person at the counter, and the
    // primary key they resolve to has exactly one spelling.
    const companyId = normaliseSlug(input.companySlug);
    const username = input.username.trim().toLowerCase();

    // Neither of these can name a row, so refusing before any lookup leaks
    // nothing an attacker does not already know about their own typing.
    if (companyId === null || !isValidUsername(username)) return err('invalid_credentials');

    const byIp = await deps.limiter.hit(LOGIN_BY_IP_SCOPE, input.ipHash, LOGIN_BY_IP);
    if (!byIp.allowed) return err('rate_limited');

    // Keyed by the tuple that was typed rather than by the user id it resolves
    // to: the cap has to apply to guesses at a username that does not exist,
    // or an attacker gets an unlimited supply of them for free.
    const attemptKey = `${companyId}:${username}`;
    const byPin = await deps.limiter.hit(PIN_SCOPE, attemptKey, PIN_ATTEMPTS);
    if (!byPin.allowed) return err('rate_limited');

    const user = await deps.users.findByCompanyAndUsername(companyId, username);
    // The PIN's *shape* is not re-checked here. That rule belongs where a PIN
    // is chosen; applied at the door it would only lock out a cashier whose
    // PIN predates the rule, and tell an attacker which shapes are worth
    // trying.
    const verified = await verifyAgainstDummy(deps.passwords, input.pin, user);
    if (user === null || !verified) return err('invalid_credentials');

    // A merchant administrator has no username, so this cannot fire today. It
    // is the guard that keeps the counter's door a cashier's door if one ever
    // gets one.
    if (user.role !== 'cashier') return err('invalid_credentials');
    if (user.status !== 'active') return err('account_disabled');

    const company = await deps.companies.findById(companyId);
    if (company === null || company.status !== 'active') return err('company_suspended');

    await deps.limiter.reset(PIN_SCOPE, attemptKey, PIN_ATTEMPTS);

    return ok(await openSession(deps, user, 'cashier', input.ipHash, input.deviceId));
  };
}
