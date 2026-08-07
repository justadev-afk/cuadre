/**
 * Cached bank OAuth tokens, in the TOKENS namespace.
 *
 * Re-authenticating on every lookup would add a round trip to the bank in front
 * of every payment the counter confirms, and some banks rate-limit the token
 * endpoint harder than the one that matters. So the token is cached — for less
 * time than the bank says it is valid, never longer.
 *
 * The key carries a *fingerprint* of the credentials, computed by the caller
 * (`sha256Hex` over client id and secret). This store therefore never sees a
 * secret, and — the reason the fingerprint exists at all — rotating a client
 * secret changes the key, so a token minted with the old credentials can never
 * be served after the rotation. Keying on bank and environment alone would go
 * on handing out the stale one until it expired.
 */
import type { z } from 'zod';

import type { BankEnvironment, BankId } from '../../application/ports/bank-gateway.ts';
import { logger } from '../../shared/logger.ts';

export type BankTokenKey = {
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  /** A hash of the credentials. Never the credentials. */
  readonly fingerprint: string;
};

/**
 * The cached value's shape belongs to the adapter that minted it — one bank's
 * token response is not another's — so the caller hands in the schema and gets
 * its own type back, parsed.
 */
export interface BankTokenStore {
  get<T>(key: BankTokenKey, shape: z.ZodType<T>): Promise<T | null>;
  put<T>(key: BankTokenKey, token: T, ttlSeconds: number): Promise<void>;
  delete(key: BankTokenKey): Promise<void>;
}

/** KV's floor. A shorter TTL is not expressible, so it is not attempted. */
const MIN_TTL_SECONDS = 60;

/**
 * A ceiling of our own. No bank token we have seen is valid for a day, and a
 * cache entry that outlives the credentials behind it is how a revoked secret
 * keeps working.
 */
const MAX_TTL_SECONDS = 60 * 60 * 24;

export class KvBankTokenStore implements BankTokenStore {
  constructor(private readonly kv: KVNamespace) {}

  async get<T>(key: BankTokenKey, shape: z.ZodType<T>): Promise<T | null> {
    const raw = await this.kv.get(cacheKey(key), 'text');
    if (raw === null) return null;

    const parsed = shape.safeParse(parseJson(raw));
    if (!parsed.success) {
      // A shape change in an adapter leaves entries no version of it can
      // read. Dropping them is cheaper than a stale-token 401 from the bank
      // in the middle of a payment.
      logger.warn('bank_token_unreadable', { bank: key.bank, environment: key.environment });
      await this.kv.delete(cacheKey(key));
      return null;
    }

    return parsed.data;
  }

  async put<T>(key: BankTokenKey, token: T, ttlSeconds: number): Promise<void> {
    const ttl = Math.trunc(ttlSeconds);
    if (ttl < MIN_TTL_SECONDS) {
      // Under a minute of life left is not worth a KV write, and KV would
      // refuse the TTL anyway. The adapter simply authenticates again.
      logger.debug('bank_token_not_cached', { bank: key.bank, ttl });
      return;
    }

    await this.kv.put(cacheKey(key), JSON.stringify(token), {
      expirationTtl: Math.min(ttl, MAX_TTL_SECONDS),
    });
  }

  async delete(key: BankTokenKey): Promise<void> {
    await this.kv.delete(cacheKey(key));
  }
}

function cacheKey(key: BankTokenKey): string {
  return `bank:${key.bank}:${key.environment}:${key.fingerprint}`;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
