/**
 * Identifier generation as a port, for the same reason `Clock` is one: a use
 * case that mints an id is not testable if the id is random.
 */

export type IdGen = {
  uuid(): string;
  /** Cryptographically random digits. Used for control codes and PINs. */
  digits(count: number): string;
  /** 32 random bytes, hex. Used for session ids and password-reset tokens. */
  token(): string;
};

export const systemIdGen: IdGen = {
  uuid: () => crypto.randomUUID(),

  digits(count) {
    // Rejection-free and unbiased enough: each byte is reduced mod 10, and the
    // 256/10 remainder skews the first six digits by under 2.4% — irrelevant
    // for a value whose uniqueness comes from a UNIQUE index, not from
    // entropy. It is not a secret (see `migrations/0001_init.sql`).
    const bytes = crypto.getRandomValues(new Uint8Array(count));
    return [...bytes].map((b) => (b % 10).toString()).join('');
  },

  token() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  },
};

/** A generator that returns queued values. Tests only. */
export function fakeIdGen(values: {
  uuids?: string[];
  digits?: string[];
  tokens?: string[];
}): IdGen {
  const uuids = [...(values.uuids ?? [])];
  const digitValues = [...(values.digits ?? [])];
  const tokens = [...(values.tokens ?? [])];
  return {
    uuid: () => uuids.shift() ?? 'uuid-exhausted',
    digits: () => digitValues.shift() ?? '000000',
    token: () => tokens.shift() ?? 'token-exhausted',
  };
}
