/**
 * Fixed-window counters in the SESSIONS namespace, `rl:<scope>:<key>:<window>`.
 *
 * The window start is part of the key, so a window never has to be reset: the
 * next one is simply a different key and the old one expires unread. There is
 * no read-modify-write to make atomic, only a counter that nobody looks at
 * again.
 *
 * **This limiter is approximate and is meant to be.** KV reads are served from
 * a colo cache with a sixty-second floor, so two counters incremented in Maiquetía
 * and in Miami inside the same minute can each believe they are the first. What
 * that stops is the slow grind — a script working through PINs over an hour —
 * which is the shape an attack on a four-digit PIN actually takes. What stops a
 * burst is elsewhere: PBKDF2 at 100k iterations makes each guess cost real CPU,
 * and the account lockout is a database fact, not a cached one. A Durable
 * Object is the upgrade when exactness starts to matter; it is not free, and it
 * is not needed to make a PIN unguessable.
 */
import type { Clock } from '../../shared/clock.ts';

export type RateLimitPolicy = {
  readonly limit: number;
  readonly windowSeconds: number;
};

export type RateLimitVerdict = {
  readonly allowed: boolean;
  /** Attempts left in this window. Zero once refused. */
  readonly remaining: number;
  /** Epoch seconds at which the window rolls over. Feeds `retry-after`. */
  readonly resetAt: number;
};

export interface RateLimiter {
  hit(scope: string, key: string, policy: RateLimitPolicy): Promise<RateLimitVerdict>;
  /** A successful login must not leave its failed attempts standing against it. */
  reset(scope: string, key: string, policy: RateLimitPolicy): Promise<void>;
}

const HOUR = 60 * 60;

/**
 * The numbers the product enforces. A PIN is four digits, so its cap is the
 * tightest by some distance — five an hour makes the whole keyspace take years
 * and still lets a cashier fat-finger it twice on a Monday. The by-IP login cap
 * is deliberately loose: a shop is one address and every till behind it shares
 * it, so squeezing that number locks out the honest counter, not the attacker.
 *
 * It stays a const in this file for now: no use case owns these numbers yet,
 * and the limiter is the only thing that reads them.
 */
export const RATE_LIMITS = {
  loginByIp: { limit: 30, windowSeconds: HOUR },
  loginByUser: { limit: 10, windowSeconds: HOUR },
  pinByUser: { limit: 5, windowSeconds: HOUR },
  passwordResetByUser: { limit: 3, windowSeconds: HOUR },
} as const satisfies Record<string, RateLimitPolicy>;

/** KV's minimum TTL. A short window's key outlives its window; nothing reads it. */
const MIN_TTL_SECONDS = 60;

export class KvRateLimiter implements RateLimiter {
  constructor(
    private readonly kv: KVNamespace,
    private readonly clock: Clock,
  ) {}

  async hit(scope: string, key: string, policy: RateLimitPolicy): Promise<RateLimitVerdict> {
    const now = this.clock.nowSeconds();
    const windowStart = Math.floor(now / policy.windowSeconds) * policy.windowSeconds;
    const resetAt = windowStart + policy.windowSeconds;
    const name = counterKey(scope, key, windowStart);

    const used = readCount(await this.kv.get(name, 'text')) + 1;
    const allowed = used <= policy.limit;

    // Once over the limit the verdict cannot change before the window rolls,
    // so the write is skipped. Under an attack that is the difference between
    // one KV write per attempt and none.
    if (allowed) {
      await this.kv.put(name, String(used), {
        expirationTtl: Math.max(MIN_TTL_SECONDS, resetAt - now),
      });
    }

    return { allowed, remaining: Math.max(0, policy.limit - used), resetAt };
  }

  async reset(scope: string, key: string, policy: RateLimitPolicy): Promise<void> {
    const windowStart =
      Math.floor(this.clock.nowSeconds() / policy.windowSeconds) * policy.windowSeconds;
    await this.kv.delete(counterKey(scope, key, windowStart));
  }
}

function counterKey(scope: string, key: string, windowStart: number): string {
  return `rl:${scope}:${key}:${windowStart}`;
}

/**
 * A missing or unparsable counter reads as zero. Failing open here is the right
 * way round: a KV hiccup must not lock a shop out of its own till, and the
 * damage a limiter can do by refusing is larger than the damage it prevents by
 * allowing one extra attempt.
 */
function readCount(raw: string | null): number {
  if (raw === null) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 0;
}
