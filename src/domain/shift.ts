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

/**
 * A gap in activity longer than this counts as the till having been *away* — the
 * app was closed, or backgrounded on a phone — rather than merely idle with
 * someone standing over it.
 */
export const SHIFT_RESUME_GAP_SECONDS = 15 * 60;

/**
 * The shift acknowledgement after the session is seen again, given how long it
 * was gone.
 *
 * Opening the till *is* a sign of presence: greeting a cashier who just launched
 * the app with "¿sigues en caja?" is a prompt they answer by the act of opening
 * it. So a session resumed after a real gap restarts its four hours from now —
 * a cold start never lands on the prompt. A quick reload, by contrast, is a
 * negligible gap and does not reset it, which is what keeps the four-hour prompt
 * from being dodged with F5 (the reason the counter lives in the record, not the
 * page). An unusable reading leaves the stamp untouched — the safe direction,
 * since the prompt is only ever a question, never a logout.
 */
export function shiftAckOnResume({
  shiftAckAt,
  lastSeenAt,
  now,
}: {
  readonly shiftAckAt: number;
  readonly lastSeenAt: number;
  readonly now: number;
}): number {
  if (!Number.isFinite(lastSeenAt) || !Number.isFinite(now)) return shiftAckAt;
  return now - lastSeenAt >= SHIFT_RESUME_GAP_SECONDS ? now : shiftAckAt;
}
