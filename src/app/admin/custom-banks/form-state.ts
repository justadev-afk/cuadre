/** State for the custom payer bank form, shared with the endpoint it posts to. */
import { ACTION_INITIAL, type ActionState } from '../../_lib/action-state.ts';

export type SaveCustomBankState = ActionState;
export const SAVE_CUSTOM_BANK_INITIAL: SaveCustomBankState = ACTION_INITIAL;
