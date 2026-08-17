/**
 * State for the reset-password form, shared by the form and the endpoint it
 * posts to.
 *
 * `redirect` is the one field a refusal never carries: the endpoint answers it
 * only when the password was set, and `useEndpointAction` turns it into a full
 * navigation so the session cookie it just wrote reaches the render that
 * follows. Where it points is the endpoint's decision — the area the new
 * session lands on, or the login door when the account may not open one.
 */
import { ACTION_INITIAL, type ActionState } from '../../_lib/action-state.ts';

export type ResetState = ActionState & { readonly redirect?: string };
export const RESET_INITIAL: ResetState = ACTION_INITIAL;
