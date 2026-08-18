/**
 * The KV snapshot of one company's statistics, one key per span.
 *
 * It shares the `SESSIONS` namespace, as the login figures do: a KV namespace
 * is a key space, and `stats:validations:` is this store's half of it. What
 * makes two questions the same question is the use case's business — the key
 * arrives already built — and everything below is the mechanics of a snapshot:
 * one JSON value, one TTL.
 */
import type {
  ValidationStatsCache,
  ValidationStatsView,
} from '../../application/validations/validation-stats.ts';

const PREFIX = 'stats:validations:';

export class KvValidationStatsCache implements ValidationStatsCache {
  constructor(private readonly kv: KVNamespace) {}

  async get(key: string): Promise<ValidationStatsView | null> {
    const raw = await this.kv.get(PREFIX + key);
    if (raw === null) return null;

    try {
      return JSON.parse(raw) as ValidationStatsView;
    } catch {
      // A value that will not parse is a miss, never a crash. This is a cache:
      // the answer behind it is one D1 batch away, and a screen that 500s
      // because of something it wrote itself is the worst of both.
      return null;
    }
  }

  async put(key: string, view: ValidationStatsView, ttlSeconds: number): Promise<void> {
    await this.kv.put(PREFIX + key, JSON.stringify(view), { expirationTtl: ttlSeconds });
  }
}
