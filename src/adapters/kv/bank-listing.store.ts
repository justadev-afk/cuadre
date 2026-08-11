/**
 * The bank's own account list, cached.
 *
 * Asking the bank which accounts a merchant has is a round trip on a service
 * that is not the one the counter runs on, and the answer changes about as often
 * as a merchant opens a new account — so it is cached for a day. What it buys is
 * not latency at the till (the counter never waits on it) but not hammering
 * Consulta de Cuentas every time a cashier switches to the Transferencia tab.
 *
 * Keyed by **connection**, not by cashier: the accounts belong to the merchant's
 * affiliation, so every till in the shop shares one entry and one refresh. The
 * value is the bank's answer as-is, masked account numbers and all — it is a
 * label source, never a search handle (see `BankAccountSummary`).
 *
 * A cached *failure* is deliberately not stored. A bank having a bad minute must
 * not switch transferencias off for a day.
 */
import type { BankAccountSummary } from '../../application/ports/bank-gateway.ts';
import { logger } from '../../shared/logger.ts';

/** A day. Long enough to be worth caching, short enough that a new account shows up. */
export const BANK_LISTING_TTL_SECONDS = 86_400;

export interface BankListingCache {
  get(bankAccountId: string): Promise<readonly BankAccountSummary[] | null>;
  put(bankAccountId: string, accounts: readonly BankAccountSummary[]): Promise<void>;
}

export class KvBankListingCache implements BankListingCache {
  constructor(private readonly kv: KVNamespace) {}

  async get(bankAccountId: string): Promise<readonly BankAccountSummary[] | null> {
    const raw = await this.kv.get(key(bankAccountId), 'text');
    if (raw === null) return null;

    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as BankAccountSummary[]) : null;
    } catch {
      // A poisoned entry is a cache miss, not an outage: the caller asks the
      // bank and overwrites it.
      logger.warn('bank_listing_cache_unreadable', { bankAccountId });
      return null;
    }
  }

  async put(bankAccountId: string, accounts: readonly BankAccountSummary[]): Promise<void> {
    await this.kv.put(key(bankAccountId), JSON.stringify(accounts), {
      expirationTtl: BANK_LISTING_TTL_SECONDS,
    });
  }
}

function key(bankAccountId: string): string {
  return `bank_listing:${bankAccountId}`;
}
