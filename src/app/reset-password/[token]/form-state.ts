/** State for the reset-password form. Out of the `'use server'` module. */
export type ResetState = { readonly error: string | null };
export const RESET_INITIAL: ResetState = { error: null };
