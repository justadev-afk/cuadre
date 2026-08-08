/** State shapes for the employee forms. Split from `actions.ts` because a
 * `'use server'` module may only export async functions — a type or a constant
 * beside the actions makes the whole file fail the RSC build. */
import { ACTION_INITIAL, type ActionState } from '../../_lib/action-state.ts';

export type CreateEmployeeState = ActionState;
export const CREATE_EMPLOYEE_INITIAL: CreateEmployeeState = ACTION_INITIAL;
