/**
 * A hand-written `D1Database` for unit tests.
 *
 * It executes no SQL. What these tests are about is the two things a repository
 * actually owns — turning a row into a domain object, and turning a rejected
 * write into a decision — and both are exercised by feeding a statement a
 * canned result or a canned error. Standing up miniflare to get real SQLite
 * would test SQLite.
 */

export type FakeCall = {
  readonly sql: string;
  readonly args: readonly unknown[];
};

/**
 * What a queued statement answers with: rows, a `meta.changes` count, or a
 * throw. `rows` doubles as the source for `first()`, which takes the head.
 */
export type FakeReply =
  | { readonly rows: readonly Record<string, unknown>[]; readonly changes?: number }
  | { readonly throws: unknown };

export type FakeD1 = {
  readonly db: D1Database;
  /** Every statement that was bound and run, in order. */
  readonly calls: FakeCall[];
  /** Queued in the order the repository will consume them. */
  reply(...replies: FakeReply[]): void;
};

export function makeFakeD1(): FakeD1 {
  const calls: FakeCall[] = [];
  const queue: FakeReply[] = [];

  function take(): FakeReply {
    return queue.shift() ?? { rows: [] };
  }

  function statement(sql: string, args: readonly unknown[]): D1PreparedStatement {
    const self: D1PreparedStatement = {
      bind: (...values: unknown[]) => statement(sql, values),

      first: async <T>(): Promise<T | null> => {
        const reply = run(sql, args, calls, take);
        const head = reply.rows[0];
        return head === undefined ? null : (head as T);
      },

      all: async <T>() => {
        const reply = run(sql, args, calls, take);
        return result<T>(reply.rows as T[], reply.changes);
      },

      run: async <T>() => {
        const reply = run(sql, args, calls, take);
        return result<T>(reply.rows as T[], reply.changes);
      },

      // Not used by any repository. `never` satisfies both declared overloads
      // without implementing either.
      raw: (): Promise<never> => {
        throw new Error('raw() is not used by the repositories');
      },
    };
    return self;
  }

  const db: D1Database = {
    prepare: (sql: string) => statement(sql, []),

    batch: async <T>(statements: D1PreparedStatement[]) => {
      const results: D1Result<T>[] = [];
      for (const each of statements) results.push(await each.run<T>());
      return results;
    },

    exec: () => {
      throw new Error('exec() is not used by the repositories');
    },

    withSession: () => {
      throw new Error('withSession() is not used by the repositories');
    },

    dump: () => {
      throw new Error('dump() is not used by the repositories');
    },
  };

  return {
    db,
    calls,
    reply: (...replies) => queue.push(...replies),
  };
}

function run(
  sql: string,
  args: readonly unknown[],
  calls: FakeCall[],
  take: () => FakeReply,
): { rows: readonly Record<string, unknown>[]; changes?: number } {
  calls.push({ sql, args });
  const reply = take();
  if ('throws' in reply) throw reply.throws;
  return reply;
}

function result<T>(results: T[], changes: number | undefined): D1Result<T> {
  return {
    success: true,
    results,
    meta: {
      duration: 0,
      size_after: 0,
      rows_read: results.length,
      rows_written: changes ?? 0,
      last_row_id: 0,
      changed_db: (changes ?? 0) > 0,
      changes: changes ?? results.length,
    },
  };
}

/** The message D1 surfaces for a violated unique index: SQLite names the columns. */
export function uniqueViolation(...columns: string[]): Error {
  return new Error(`D1_ERROR: UNIQUE constraint failed: ${columns.join(', ')}: SQLITE_CONSTRAINT`);
}
