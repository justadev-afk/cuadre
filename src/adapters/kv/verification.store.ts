/**
 * The `VerificationStore` port, backed by the TOKENS namespace.
 *
 * A bank onboarding is two steps with a human decision between them — verify
 * the credentials, then pick which account receives the payments — and the
 * sealed credentials wait here, under a random id, for the length of that
 * decision. Ten minutes (the use case sets the TTL) and then they are gone: an
 * abandoned onboarding leaves nothing decryptable behind.
 *
 * The whole job of this adapter is encoding. `Sealed` carries `Uint8Array`s,
 * which do not survive `JSON.stringify`, so they go in as base64 and come back
 * out as bytes. Nothing here can read what it stores — the master key lives in
 * the use case, never in this adapter.
 */

import type { VerificationStore } from '../../application/banking/pending-verification.ts';
import { fromBase64, type Sealed, toBase64 } from '../../shared/crypto.ts';

const KEY_PREFIX = 'verify:';

/** The on-KV shape: the same three fields as `Sealed`, with the bytes encoded. */
type StoredVerification = {
  ciphertext: string;
  iv: string;
  keyVersion: number;
};

export class KvVerificationStore implements VerificationStore {
  constructor(private readonly kv: KVNamespace) {}

  async put(verifyId: string, sealed: Sealed, ttlSeconds: number): Promise<void> {
    const stored: StoredVerification = {
      ciphertext: toBase64(sealed.ciphertext),
      iv: toBase64(sealed.iv),
      keyVersion: sealed.keyVersion,
    };
    await this.kv.put(`${KEY_PREFIX}${verifyId}`, JSON.stringify(stored), {
      expirationTtl: ttlSeconds,
    });
  }

  async get(verifyId: string): Promise<Sealed | null> {
    const raw = await this.kv.get<StoredVerification>(`${KEY_PREFIX}${verifyId}`, 'json');
    if (raw === null) return null;

    return {
      ciphertext: fromBase64(raw.ciphertext),
      iv: fromBase64(raw.iv),
      keyVersion: raw.keyVersion,
    };
  }

  async delete(verifyId: string): Promise<void> {
    await this.kv.delete(`${KEY_PREFIX}${verifyId}`);
  }
}
