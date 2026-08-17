/** State for the "nueva empresa" form, shared with the endpoint it posts to. */
import { ACTION_INITIAL, type ActionState } from '../../_lib/action-state.ts';

export type CreateCompanyState = ActionState;
export const CREATE_COMPANY_INITIAL: CreateCompanyState = ACTION_INITIAL;
