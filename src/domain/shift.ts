/**
 * The cashier shift check.
 *
 * Every four hours the counter asks the cashier to confirm they are still the
 * one at the till. It is a confirmation, not a re-login: it exists so that a
 * validation stays attributable to whoever actually ran it when a till changes
 * hands mid-day.
 */

export const SHIFT_CONFIRMATION_SECONDS = 4 * 60 * 60;

export type ShiftState = {
  /** Epoch seconds of the last confirmation, or `null` if never confirmed. */
  readonly shiftAckAt: number | null;
  /** Epoch seconds, from the `Clock` port. */
  readonly now: number;
};

/**
 * There is deliberately **no auto-logout** attached to this. Throwing a cashier
 * out mid-sale — customer waiting, reference already typed — is a worse outcome
 * than the risk an idle session carries at a supervised counter, where the till
 * is in sight of the person responsible for it. So this returns a prompt, and
 * a prompt is all it ever returns.
 *
 * A confirmation stamped in the future means the row cannot be trusted (a
 * corrupt write, or a clock that moved), and an untrustworthy stamp must not be
 * what suppresses the question.
 */
export function needsShiftConfirmation({ shiftAckAt, now }: ShiftState): boolean {
  if (shiftAckAt === null) return true;
  if (!Number.isFinite(shiftAckAt) || !Number.isFinite(now)) return true;
  if (shiftAckAt > now) return true;
  return now - shiftAckAt >= SHIFT_CONFIRMATION_SECONDS;
}
