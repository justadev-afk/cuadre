/**
 * The KV snapshot of the login figures. One key, a JSON blob, a TTL — so
 * `/login` reads a single value instead of scanning D1 on every anonymous hit.
 */
import type { LoginStats, LoginStatsCache } from '../../application/stats/login-stats.ts';

const KEY = 'login-stats';

export class KvLoginStatsCache implements LoginStatsCache {
  constructor(private readonly kv: KVNamespace) {}

  async get(): Promise<LoginStats | null> {
    return (await this.kv.get<LoginStats>(KEY, 'json')) ?? null;
  }

  async put(stats: LoginStats, ttlSeconds: number): Promise<void> {
    await this.kv.put(KEY, JSON.stringify(stats), { expirationTtl: ttlSeconds });
  }
}
