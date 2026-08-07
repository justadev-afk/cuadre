'use server';

/**
 * The company's bank actions. The onboarding pair (verify, then connect) and the
 * two levers on an existing account (deactivate, cambiar credenciales). The
 * `/banks` area is company-only — a cashier never reaches it — so `requireCompany`
 * is the whole permission check, and everything is scoped to the session's
 * company. The verify/connect bodies live in `connect-core.ts`, shared with the
 * admin's copy of the flow.
 */
import { revalidatePath } from 'next/cache';

import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { textField } from '../../_lib/inputs.ts';
import { changeBankCredentialsCore } from './change-credentials-core.ts';
import { connectBankCore, verifyBankCore } from './connect-core.ts';
import type {
  ChangeCredentialsState,
  ConnectState,
  RemoveBankState,
  VerifyState,
} from './form-state.ts';

export async function verifyBankAction(
  _previous: VerifyState,
  form: FormData,
): Promise<VerifyState> {
  const { companyId } = await requireCompany();
  return verifyBankCore(companyId, form);
}

export async function connectBankAction(
  _previous: ConnectState,
  form: FormData,
): Promise<ConnectState> {
  const { companyId } = await requireCompany();
  const result = await connectBankCore(companyId, form);
  if (result.step === 'done') revalidatePath('/banks');
  return result;
}

/**
 * Deactivating a connected account. A company can turn an account off but never
 * edit the number or the bank; "off" is a soft state (`removeBankAccount` sets
 * the status, never deletes), so the validation history keeps resolving and the
 * account can be connected again later.
 */
export async function removeBankAccountAction(
  _previous: RemoveBankState,
  form: FormData,
): Promise<RemoveBankState> {
  const { companyId } = await requireCompany();
  const accountId = textField(form, 'accountId');
  if (accountId === '') return { ok: false, error: 'Cuenta inválida.' };

  const result = await container().banking.removeBankAccount({ companyId, accountId });
  if (!result.ok) return { ok: false, error: 'No se pudo desactivar la cuenta.' };

  revalidatePath('/banks');
  return { ok: true, error: null };
}

/**
 * Replacing a connected account's credentials — the change is scoped to the
 * session's company and shares its body with the admin action.
 */
export async function changeCredentialsAction(
  _previous: ChangeCredentialsState,
  form: FormData,
): Promise<ChangeCredentialsState> {
  const { companyId } = await requireCompany();
  const result = await changeBankCredentialsCore(companyId, form);
  if (result.ok) revalidatePath('/banks');
  return result;
}
