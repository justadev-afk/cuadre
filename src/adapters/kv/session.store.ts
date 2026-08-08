/**
 * Sessions, in the SESSIONS namespace under `session:<id>`.
 *
 * The TTL slides: every authenticated request renews it, and nothing sets an
 * absolute lifetime. That is deliberate. A cashier's shift outlasts any expiry
 * we would pick, and being logged out mid-transaction with a customer waiting
 * is a worse failure than a long idle window. What re-establishes who is at the
 * till is the shift acknowledgement, not an expiry.
 *
 * `shiftAckAt` lives in this record and not in the browser. The four-hour
 * counter has to survive a reload, a second tab and a different device, because
 * a cashier who wants to skip the prompt would otherwise only have to press
 * F5 — and the whole point of the prompt is that the person confirming payments
 * is the person we think it is.
 *
 * What a reload must *not* do is what merely opening the app does. A session
 * resolved again after a real gap — the app was closed, or a phone was pocketed
 * and taken back out — restarts the shift clock (`shiftAckOnResume`), because
 * opening the till is itself a sign of presence and greeting that with the
 * prompt is nonsense. `lastSeenAt`, written on a slow cadence here, is how the
 * resolve path tells that resume from an F5.
 */
import { z } from 'zod';

import { shiftAckOnResume } from '../../domain/shift.ts';
import type { Clock } from '../../shared/clock.ts';
import { logger } from '../../shared/logger.ts';

const SESSION_PREFIX = 'session:';
const USER_INDEX_PREFIX = 'session-user:';

/** Thirty days of inactivity. See the note above on why there is no cap. */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * KV does not want more than one write per second to the same key, and a
 * sliding TTL renewed literally on every request is exactly that during a busy
 * hour at the counter. The record is rewritten only once the last renewal is
 * old enough for the TTL to be worth topping up; against a thirty-day window,
 * an hour of slack costs nothing.
 */
const RENEW_AFTER_SECONDS = 60 * 60;

/**
 * How often `lastSeenAt` is written down. It has to be fresher than the
 * resume-gap the shift clock reads it against (`SHIFT_RESUME_GAP_SECONDS`, 15
 * min), or a still-open till would look like it had gone away — so five minutes,
 * a comfortable third of the gap. Between writes the value drifts by at most
 * this much, which the gap absorbs. A heartbeat runs every couple of minutes,
 * so this is a handful of writes an hour per open till, not one per request.
 */
const LAST_SEEN_WRITE_AFTER_SECONDS = 5 * 60;

export const SessionRecord = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'company', 'cashier']),
  /** `null` only for a platform admin, mirroring `users.company_id`. */
  companyId: z.string().min(1).nullable(),
  name: z.string(),
  /** A cashier has the username; every other role has the email. Never both. */
  username: z.string().nullable(),
  email: z.string().nullable(),
  createdAt: z.number().int(),
  /** Epoch seconds of the last shift acknowledgement. */
  shiftAckAt: z.number().int(),
  /**
   * Epoch seconds this session was last resolved. Optional: records written
   * before it existed parse fine and fall back to `shiftAckAt` on the first
   * read, which then stamps it.
   */
  lastSeenAt: z.number().int().optional(),
  /** `hashIp()` output. A raw address is never written here. */
  ipHash: z.string(),
  /** The persistent browser id this session was minted for. See the domain type. */
  deviceId: z.string(),
});

export type SessionRecord = z.infer<typeof SessionRecord>;

/** When this record was last written, so `touch` knows whether to write again. */
type SessionMeta = { renewedAt: number };

export interface SessionStore {
  put(id: string, record: SessionRecord): Promise<void>;
  get(id: string): Promise<SessionRecord | null>;
  /** Reads and renews the sliding TTL. The one call an authenticated request makes. */
  touch(id: string): Promise<SessionRecord | null>;
  ackShift(id: string, at: number): Promise<SessionRecord | null>;
  delete(id: string): Promise<void>;
  /** Every device this user is signed in on. Returns how many were ended. */
  deleteAllForUser(userId: string): Promise<number>;
}

export class KvSessionStore implements SessionStore {
  constructor(
    private readonly kv: KVNamespace,
    private readonly clock: Clock,
  ) {}

  async put(id: string, record: SessionRecord): Promise<void> {
    const metadata: SessionMeta = { renewedAt: this.clock.nowSeconds() };
    // KV cannot be queried by value, so the reverse index is a second key. Both
    // carry the same TTL, which means the index cannot outlive what it points
    // at and never needs sweeping.
    await Promise.all([
      this.kv.put(SESSION_PREFIX + id, JSON.stringify(record), {
        expirationTtl: SESSION_TTL_SECONDS,
        metadata,
      }),
      this.kv.put(indexKey(record.userId, id), id, { expirationTtl: SESSION_TTL_SECONDS }),
    ]);
  }

  async get(id: string): Promise<SessionRecord | null> {
    const stored = await this.read(id);
    return stored === null ? null : stored.record;
  }

  async touch(id: string): Promise<SessionRecord | null> {
    const stored = await this.read(id);
    if (stored === null) return null;

    const now = this.clock.nowSeconds();
    // A record from before `lastSeenAt` existed reads its shift stamp as the
    // last time we saw it — the most it could have been active.
    const lastSeenAt = stored.record.lastSeenAt ?? stored.record.shiftAckAt;
    // Resumed after a gap? Restart the shift clock, so a cold start never lands
    // on the prompt. A quick reload is too small a gap to reset — F5 still can't
    // dodge it.
    const shiftAckAt = shiftAckOnResume({ shiftAckAt: stored.record.shiftAckAt, lastSeenAt, now });
    const record: SessionRecord = { ...stored.record, shiftAckAt, lastSeenAt: now };

    // Write when the shift restarted (that must persist), when the TTL is due to
    // slide, or when `lastSeenAt` has drifted far enough that the next resume
    // check would misread a still-open till as having gone away.
    const write =
      shiftAckAt !== stored.record.shiftAckAt ||
      now - stored.renewedAt >= RENEW_AFTER_SECONDS ||
      now - lastSeenAt >= LAST_SEEN_WRITE_AFTER_SECONDS;
    if (write) await this.put(id, record);

    return record;
  }

  async ackShift(id: string, at: number): Promise<SessionRecord | null> {
    const stored = await this.read(id);
    if (stored === null) return null;

    const acknowledged: SessionRecord = { ...stored.record, shiftAckAt: at, lastSeenAt: at };
    await this.put(id, acknowledged);
    return acknowledged;
  }

  async delete(id: string): Promise<void> {
    // The record has to be read first: the reverse-index key is derived from
    // the user id, which only the record carries.
    const stored = await this.read(id);
    await Promise.all([
      this.kv.delete(SESSION_PREFIX + id),
      ...(stored === null ? [] : [this.kv.delete(indexKey(stored.record.userId, id))]),
    ]);
  }

  async deleteAllForUser(userId: string): Promise<number> {
    let cursor: string | undefined;
    let ended = 0;

    do {
      const listed = await this.kv.list({ prefix: `${USER_INDEX_PREFIX}${userId}:`, cursor });
      await Promise.all(
        listed.keys.flatMap((key) => [
          this.kv.delete(key.name),
          this.kv.delete(SESSION_PREFIX + sessionIdOf(key.name)),
        ]),
      );
      ended += listed.keys.length;
      cursor = listed.list_complete ? undefined : listed.cursor;
    } while (cursor !== undefined);

    return ended;
  }

  private async read(id: string): Promise<{ record: SessionRecord; renewedAt: number } | null> {
    const stored = await this.kv.getWithMetadata<SessionMeta>(SESSION_PREFIX + id, 'text');
    if (stored.value === null) return null;

    const parsed = SessionRecord.safeParse(parseJson(stored.value));
    if (!parsed.success) {
      // A record written in an older shape can never become valid, so it is
      // dropped rather than retried on every request. The session id is a live
      // credential and is not logged, which leaves this line thin on purpose.
      logger.warn('session_record_unreadable');
      await this.kv.delete(SESSION_PREFIX + id);
      return null;
    }

    return { record: parsed.data, renewedAt: stored.metadata?.renewedAt ?? 0 };
  }
}

function indexKey(userId: string, sessionId: string): string {
  return `${USER_INDEX_PREFIX}${userId}:${sessionId}`;
}

/** The session id is the last segment; user ids are uuids and carry no colon. */
function sessionIdOf(indexKeyName: string): string {
  return indexKeyName.slice(indexKeyName.lastIndexOf(':') + 1);
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
