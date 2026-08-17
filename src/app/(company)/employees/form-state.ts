/** State shapes for the employee forms, shared by the dialogs and the endpoints
 * they post to. */
import { ACTION_INITIAL, type ActionState } from '../../_lib/action-state.ts';

export type CreateEmployeeState = ActionState;
export const CREATE_EMPLOYEE_INITIAL: CreateEmployeeState = ACTION_INITIAL;

/**
 * Access is a switch, so the confirmation is a sentence rather than a closing
 * dialog: `note` carries "se desactivó / se reactivó" to the toast on the way
 * back. Nothing is ever deleted, which is why this is not a delete state.
 */
export type EmployeeAccessState = ActionState & { readonly note?: string | null };
export const EMPLOYEE_ACCESS_INITIAL: EmployeeAccessState = ACTION_INITIAL;
