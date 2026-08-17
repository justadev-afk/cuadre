/** State for the change-password form, shared with the endpoint it posts to. */
export type ChangePasswordState = { readonly error: string | null };
export const CHANGE_PASSWORD_INITIAL: ChangePasswordState = { error: null };
