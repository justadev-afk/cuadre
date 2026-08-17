/** State for the forgot-password form, shared with the endpoint it posts to. */
export type ForgotState = { readonly done: boolean; readonly error: string | null };
export const FORGOT_INITIAL: ForgotState = { done: false, error: null };
