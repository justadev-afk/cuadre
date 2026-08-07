/** State for the forgot-password form. Out of the `'use server'` module. */
export type ForgotState = { readonly done: boolean; readonly error: string | null };
export const FORGOT_INITIAL: ForgotState = { done: false, error: null };
