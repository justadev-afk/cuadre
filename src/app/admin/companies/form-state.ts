/** State for the "nueva empresa" form. Out of the `'use server'` module, which
 * may only export async functions. */
export type CreateCompanyState = { readonly error: string | null; readonly ok: boolean };
export const CREATE_COMPANY_INITIAL: CreateCompanyState = { error: null, ok: false };
