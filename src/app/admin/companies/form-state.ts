/** State for the "nueva empresa" form. Out of the `'use server'` module, which
 * may only export async functions. */
import { ACTION_INITIAL, type ActionState } from '../../_lib/action-state.ts';

export type CreateCompanyState = ActionState;
export const CREATE_COMPANY_INITIAL: CreateCompanyState = ACTION_INITIAL;
