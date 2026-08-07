/** State shapes for the employee forms. Split from `actions.ts` because a
 * `'use server'` module may only export async functions — a type or a constant
 * beside the actions makes the whole file fail the RSC build. */
export type CreateEmployeeState = { readonly error: string | null; readonly ok: boolean };
export const CREATE_EMPLOYEE_INITIAL: CreateEmployeeState = { error: null, ok: false };
