/** State for the change-password form — kept out of the `'use server'` module,
 * which may only export async functions. */
export type ChangePasswordState = { readonly error: string | null };
export const CHANGE_PASSWORD_INITIAL: ChangePasswordState = { error: null };
