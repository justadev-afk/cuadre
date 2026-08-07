/**
 * Everything that touches WebCrypto: sealing secrets at rest, hashing
 * passwords and PINs, and the one-way hashes for reset tokens and IPs.
 *
 * Nothing here is a business rule, so none of it belongs in `src/domain` —
 * but it is also not an adapter, because there is no port to swap: WebCrypto
 * is the same API in `wrangler dev` and in production.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Which key sealed a given row. `CREDS_KEY` is expected to rotate; the stored
 * version is what tells a future decrypt which key it needs. There is one key
 * today, so nothing branches on it yet — it is written because adding the
 * column afterwards means re-encrypting blind.
 */
export const CURRENT_KEY_VERSION = 1;

/** 96 bits, the size AES-GCM is specified for. Never reused across messages. */
const IV_BYTES = 12;

export type Sealed = {
  ciphertext: Uint8Array;
  iv: Uint8Array;
  keyVersion: number;
};

/**
 * The master key is stretched per version, so version 2 is a different key
 * even if the operator reuses the same secret string by mistake.
 */
async function masterKey(secret: string, version: number, usage: 'encrypt' | 'decrypt') {
  const bits = await crypto.subtle.digest('SHA-256', encoder.encode(`${secret}:v${version}`));
  return crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, [usage]);
}

/** Seals any JSON-serialisable value. Each call mints its own IV. */
export async function seal(secret: string, value: unknown): Promise<Sealed> {
  const key = await masterKey(secret, CURRENT_KEY_VERSION, 'encrypt');
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(JSON.stringify(value)),
  );

  return { ciphertext: new Uint8Array(ciphertext), iv, keyVersion: CURRENT_KEY_VERSION };
}

/**
 * Throws if the ciphertext or its tag was tampered with — that is AES-GCM
 * doing its job. A caller that cannot decrypt a bank's credentials must treat
 * the account as unusable, not carry on with a partial value.
 */
export async function unseal<T>(secret: string, sealed: Sealed): Promise<T> {
  const key = await masterKey(secret, sealed.keyVersion, 'decrypt');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.iv as BufferSource },
    key,
    sealed.ciphertext as BufferSource,
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

// ── passwords and PINs ─────────────────────────────────────────────────────

/**
 * 100 000 is the ceiling, not a preference: Cloudflare Workers' WebCrypto
 * refuses PBKDF2 with `iterations` above 100 000, throwing `NotSupportedError`
 * at runtime. It does not surface in `wrangler dev`, which uses Node's crypto
 * and happily runs more — so a higher count passes every local test and then
 * 500s every login in production. OWASP's floor is higher, but the platform
 * decides this one. It is stored in the hash string so a future raise — if the
 * cap ever lifts — does not invalidate existing rows.
 */
const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_BITS = 256;

/** `pbkdf2$<iterations>$<salt-b64>$<hash-b64>` — self-describing, so the cost can change. */
export async function hashPassword(plaintext: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const derived = await derive(plaintext, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(derived)}`;
}

export async function verifyPassword(plaintext: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, expected] = stored.split('$');
  if (scheme !== 'pbkdf2' || !iterations || !salt || !expected) return false;

  const derived = await derive(plaintext, fromBase64(salt), Number(iterations));
  return timingSafeEqual(toBase64(derived), expected);
}

async function derive(plaintext: string, salt: Uint8Array, iterations: number) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(plaintext), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    DERIVED_BITS,
  );
  return new Uint8Array(bits);
}

// ── one-way hashes ─────────────────────────────────────────────────────────

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * An IP is personal data and we only ever need to ask "was this the same
 * caller?". The pepper means a database dump cannot be brute-forced back to
 * addresses, which a bare SHA-256 of an IPv4 absolutely can be.
 */
export function hashIp(ip: string, pepper: string): Promise<string> {
  return sha256Hex(`${pepper}:${ip}`);
}

/** Constant-time compare, so a token check cannot be timed character by character. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── encoding ───────────────────────────────────────────────────────────────

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
