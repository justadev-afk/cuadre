'use server';

/**
 * The company's bank actions: connecting one, and the two levers on an existing
 * connection (deactivate, cambiar credenciales). The `/banks` area is
 * company-only — a cashier never reaches it — so `requireCompany` is the whole
 * permission check, and everything is scoped to the session's company. The
 * connect body lives in `connect-core.ts`, shared with the admin's copy.
 */
import { revalidatePath } from 'next/cache';

import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { textField } from '../../_lib/inputs.ts';
import { changeBankCredentialsCore } from './change-credentials-core.ts';
import { connectBankCore } from './connect-core.ts';
import type {
  ChangeCredentialsState,
  ConnectState,
  ReceivingAccountsState,
  RemoveBankState,
} from './form-state.ts';

export async function connectBankAction(
  _previous: ConnectState,
  form: FormData,
): Promise<ConnectState> {
  const { companyId } = await requireCompany();
  const result = await connectBankCore(companyId, form);
  if (result.ok) revalidatePath('/banks');
  return result;
}

/**
 * Deactivating a connected bank. A company can turn a connection off but never
 * edit the bank it points at; "off" is a soft state (`removeBankAccount` sets
 * the status, never deletes), so the validation history keeps resolving and the
 * bank can be connected again later.
 */
export async function removeBankAccountAction(
  _previous: RemoveBankState,
  form: FormData,
): Promise<RemoveBankState> {
  const { companyId } = await requireCompany();
  const accountId = textField(form, 'accountId');
  if (accountId === '') return { ok: false, error: 'Cuenta inválida.' };

  const result = await container().banking.removeBankAccount({ companyId, accountId });
  if (!result.ok) return { ok: false, error: 'No se pudo desactivar el banco.' };

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

/**
 * Replacing the accounts a connection receives transferencias in. No bank is
 * called: these are the merchant's own numbers, and the use case drops anything
 * that does not match the bank's rule before it writes.
 */
export async function setReceivingAccountsAction(
  _previous: ReceivingAccountsState,
  form: FormData,
): Promise<ReceivingAccountsState> {
  const { companyId } = await requireCompany();
  const accountId = textField(form, 'accountId');
  if (accountId === '') return { ok: false, error: 'Cuenta inválida.' };

  const result = await container().banking.setReceivingAccounts({
    companyId,
    bankAccountId: accountId,
    // One per line, as the field posts them.
    accounts: textField(form, 'receivingAccounts').split(/[\n,]/),
  });
  if (!result.ok) return { ok: false, error: 'No se pudieron guardar las cuentas.' };

  revalidatePath('/banks');
  // The till reads this list to fill its dropdown, so it has to see the change.
  revalidatePath('/checkout');
  revalidatePath('/checkout-express');
  return { ok: true, error: null };
}
