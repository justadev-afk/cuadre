/**
 * An in-memory `KVNamespace` for unit tests.
 *
 * It keeps values, metadata and the TTL that was asked for, which is all these
 * stores care about — the sliding renewal, the reverse index and the fixed
 * window are all decisions made from what was written, not from what KV does
 * with it afterwards. Expiry is not simulated: nothing here tests that KV can
 * delete a key on time.
 */

type Entry = {
  value: string;
  metadata: unknown;
  /** What the caller asked for, so a test can assert the sliding TTL. */
  expirationTtl: number | null;
};

export type FakeKv = {
  readonly kv: KVNamespace;
  readonly entries: Map<string, Entry>;
  /** How many times a given key has been written. Guards the renewal throttle. */
  readonly writes: Map<string, number>;
};

export function makeFakeKv(): FakeKv {
  const entries = new Map<string, Entry>();
  const writes = new Map<string, number>();

  const namespace = {
    async get(key: string): Promise<string | null> {
      return entries.get(key)?.value ?? null;
    },

    async getWithMetadata(key: string) {
      const entry = entries.get(key);
      return {
        value: entry?.value ?? null,
        metadata: entry?.metadata ?? null,
        cacheStatus: null,
      };
    },

    async put(
      key: string,
      value: string,
      options?: { expirationTtl?: number; metadata?: unknown },
    ): Promise<void> {
      entries.set(key, {
        value,
        metadata: options?.metadata ?? null,
        expirationTtl: options?.expirationTtl ?? null,
      });
      writes.set(key, (writes.get(key) ?? 0) + 1);
    },

    async delete(key: string): Promise<void> {
      entries.delete(key);
    },

    async list(options?: { prefix?: string | null }) {
      const prefix = options?.prefix ?? '';
      const keys = [...entries.keys()]
        .filter((name) => name.startsWith(prefix))
        .sort()
        .map((name) => ({ name }));
      return { keys, list_complete: true as const, cacheStatus: null };
    },
  };

  // `KVNamespace` declares two dozen `get` overloads for return types these
  // stores never ask for. Implementing all of them to satisfy the compiler
  // would be noise around a Map, so the shape is asserted once, here, and
  // nowhere else in the codebase.
  return { kv: namespace as unknown as KVNamespace, entries, writes };
}
