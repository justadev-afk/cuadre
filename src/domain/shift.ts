/**
 * The cashier shift check — **switched off**, see `SHIFT_CONFIRMATION_ENABLED`.
 *
 * Every four hours the counter asks the cashier to confirm they are still the
 * one at the till. It is a confirmation, not a re-login: it exists so that a
 * validation stays attributable to whoever actually ran it when a till changes
 * hands mid-day.
 *
 * The rule below is intact and tested in both positions of the switch, so the
 * feature is one constant away from being live rather than one rewrite away.
 */

/**
 * **The switch. Currently off.**
 *
 * A shift that lasts what it lasts: nothing interrupts the person at the till,
 * and a session ends when somebody signs out, signs in elsewhere, or loses the
 * account behind it. The prompt turned out to buy less than it cost — it
 * interrupts a counter mid-shift to ask a question the act of using the till
 * already answers.
 *
 * It is a constant rather than a deletion because the rule is sound and the
 * whole flow — the domain check, the acknowledgement, the dialog, its endpoint —
 * stays whole and tested behind it. Flip this to `true` and push (a push
 * auto-deploys) and every piece is live again, unchanged. This is the *only*
 * place that decides: `needsShiftConfirmation` is what every screen and the
 * resolve path ask, so a second opinion cannot be written anywhere else.
 *
 * The counterpart for the client-side switches is `src/app/_lib/flags.ts`; this
 * one lives here because the application layer reads it, and the domain may not
 * import from `src/app`.
 */
export const SHIFT_CONFIRMATION_ENABLED = false;

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
export function needsShiftConfirmation(state: ShiftState): boolean {
  // The switch answers for every case below it, including the ones that fail
  // closed: an untrustworthy stamp cannot raise a prompt that has been turned
  // off. The rule is asked second and is unchanged by any of this.
  return SHIFT_CONFIRMATION_ENABLED && shiftWindowElapsed(state);
}

/**
 * The four-hour rule itself, with no opinion about whether the app acts on it.
 *
 * Split from `needsShiftConfirmation` so the switch cannot cost us the
 * specification: the table test drives *this*, and goes on meaning what it says
 * while the prompt is off. Nothing outside this module calls it — screens ask
 * the question above, which is the one that knows about the switch.
 */
export function shiftWindowElapsed({ shiftAckAt, now }: ShiftState): boolean {
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
