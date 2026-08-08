/**
 * The shape every "did it work?" server action answers with.
 *
 * A form that either succeeds or explains itself needs exactly two things, and
 * four modules had each declared their own identical pair. One shape means one
 * place to change it, and — more to the point — one contract `useActionOutcome`
 * can react to, instead of a hand-written pair of effects per dialog.
 *
 * `ok: false, error: null` is the initial state: nothing has been submitted yet.
 * A module still names its own alias (`CreateEmployeeState`) so its actions read
 * in its own vocabulary; the shape underneath is this one.
 */
export type ActionState = { readonly ok: boolean; readonly error: string | null };

export const ACTION_INITIAL: ActionState = { ok: false, error: null };
