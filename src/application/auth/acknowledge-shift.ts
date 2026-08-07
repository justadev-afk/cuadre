/**
 * *Continuar* on the four-hour prompt: the shift counter restarts from now.
 *
 * The stamp lives in the session record, not in the browser. A cashier who
 * wanted to skip the prompt would otherwise only have to reload the page or
 * open a second tab, and the entire point of the prompt is that the person
 * confirming payments is the person we think is at the till.
 *
 * It is logged for the same reason it exists: a validation has to stay
 * attributable to whoever actually ran it, and when a till changes hands
 * mid-day this line is the record of who took it over and when.
 */
import type { Clock } from '../../shared/clock.ts';
import { logger } from '../../shared/logger.ts';
import { type SessionRecord, type StoredSession, toSessionRecord } from '../session.ts';

export type AcknowledgeShiftInput = { readonly sessionId: string };

export type AcknowledgeShiftDeps = {
  readonly sessions: { ackShift(id: string, at: number): Promise<StoredSession | null> };
  readonly clock: Clock;
};

/** `null` when the session is gone — the prompt was answered too late. */
export type AcknowledgeShift = (input: AcknowledgeShiftInput) => Promise<SessionRecord | null>;

export function makeAcknowledgeShift(deps: AcknowledgeShiftDeps): AcknowledgeShift {
  return async ({ sessionId }) => {
    const at = deps.clock.nowSeconds();
    const stored = await deps.sessions.ackShift(sessionId, at);
    if (stored === null) return null;

    const session = toSessionRecord(stored);
    if (session === null) return null;

    logger.info('shift_acknowledged', {
      userId: session.userId,
      companyId: session.companyId,
      role: session.role,
      at,
    });

    return session;
  };
}
