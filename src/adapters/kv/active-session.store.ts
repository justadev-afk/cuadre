/**
 * The per-user "one active session" pointer, in the SESSIONS namespace under
 * `user-active-session:<userId>`.
 *
 * One key per user, naming the session id that is currently allowed. Sign-in
 * writes it (`setActive`); the resolve path reads it (`getActive`) and treats
 * any session whose id does not match as superseded — the user signed in
 * somewhere else. The old session record is deliberately left alone: deleting
 * it would resolve to nobody and sign the user out with no explanation, whereas
 * a record that still parses but is no longer named by the pointer is what lets
 * the resolve path say *why* it stopped working.
 *
 * The TTL matches the session's own sliding window, so a user with no live
 * session eventually loses their pointer too and nothing lingers. A pointer in
 * a shape an older deploy wrote parses to `null` and fails open — the worst it
 * costs is one missed supersession until the next sign-in rewrites it.
 */
import { z } from 'zod';

import { logger } from '../../shared/logger.ts';
import { SESSION_TTL_SECONDS } from './session.store.ts';

const ACTIVE_PREFIX = 'user-active-session:';

export const ActiveSessionPointer = z.object({
  sessionId: z.string().min(1),
  deviceId: z.string(),
  /** Epoch seconds the pointer was written. */
  at: z.number().int(),
});

export type ActiveSessionPointer = z.infer<typeof ActiveSessionPointer>;

export interface ActiveSessionStore {
  setActive(userId: string, pointer: ActiveSessionPointer): Promise<void>;
  getActive(userId: string): Promise<ActiveSessionPointer | null>;
}

export class KvActiveSessionStore implements ActiveSessionStore {
  constructor(private readonly kv: KVNamespace) {}

  async setActive(userId: string, pointer: ActiveSessionPointer): Promise<void> {
    await this.kv.put(ACTIVE_PREFIX + userId, JSON.stringify(pointer), {
      expirationTtl: SESSION_TTL_SECONDS,
    });
  }

  async getActive(userId: string): Promise<ActiveSessionPointer | null> {
    const raw = await this.kv.get(ACTIVE_PREFIX + userId, 'text');
    if (raw === null) return null;

    const parsed = ActiveSessionPointer.safeParse(parseJson(raw));
    if (!parsed.success) {
      // A pointer written in an older shape can never become valid. Failing
      // open here means one missed supersession, not a locked-out user, and the
      // next sign-in rewrites it in the current shape.
      logger.warn('active_session_pointer_unreadable');
      return null;
    }

    return parsed.data;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
