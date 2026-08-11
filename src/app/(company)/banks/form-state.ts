/**
 * State shapes for the bank forms. Split from `actions.ts` because a
 * `'use server'` module may only export async functions — a type or a constant
 * beside the actions makes the whole file fail the RSC build.
 */
import { ACTION_INITIAL, type ActionState } from '../../_lib/action-state.ts';

/**
 * Connecting a bank is one submit now: the credentials are proven and the row
 * is written in the same request, so there is no intermediate step to model and
 * the state is the same `{ ok, error }` every other action answers with (§11).
 */
export type ConnectState = ActionState & {
  /** The `credentialGroups` key a refusal belongs to, so the form can point at it. */
  readonly groupKey?: string;
};

export const CONNECT_INITIAL: ConnectState = ACTION_INITIAL;

/** The deactivate confirm dialog's action state. */
export type RemoveBankState = ActionState;
export const REMOVE_BANK_INITIAL: RemoveBankState = ACTION_INITIAL;

/** The "cambiar credenciales" modal's action state (company and admin share it). */
export type ChangeCredentialsState = ActionState;
export const CHANGE_CREDENTIALS_INITIAL: ChangeCredentialsState = ACTION_INITIAL;

/** The "cuentas receptoras" editor's action state. */
export type ReceivingAccountsState = ActionState;
export const RECEIVING_ACCOUNTS_INITIAL: ReceivingAccountsState = ACTION_INITIAL;
