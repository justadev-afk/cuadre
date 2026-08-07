'use server';

/**
 * The admin's copy of "cambiar credenciales", reachable from a company's detail
 * page. Guarded by the admin area — a cashier or a company never reaches
 * `/admin/**` — and it takes the target company from the form, because an admin
 * acts on a company that is not its own. The change itself is the shared core.
 */
import { revalidatePath } from 'next/cache';
import { requireArea } from '../../../_lib/area-guard.ts';
import { textField } from '../../../_lib/inputs.ts';
import { changeBankCredentialsCore } from '../../../(company)/banks/change-credentials-core.ts';
import { connectBankCore, verifyBankCore } from '../../../(company)/banks/connect-core.ts';
import type {
  ChangeCredentialsState,
  ConnectState,
  VerifyState,
} from '../../../(company)/banks/form-state.ts';

export async function changeCredentialsAdminAction(
  _previous: ChangeCredentialsState,
  form: FormData,
): Promise<ChangeCredentialsState> {
  await requireArea('admin');
  const companyId = textField(form, 'companyId');
  if (companyId === '') return { ok: false, error: 'Empresa inválida.' };

  const result = await changeBankCredentialsCore(companyId, form);
  if (result.ok) revalidatePath(`/admin/companies/${companyId}`);
  return result;
}

/**
 * The admin's copy of the onboarding pair — connect a bank FOR a company during
 * initial setup. Guarded by the admin area (a cashier or a company never reaches
 * `/admin/**`) and scoped to the target company carried in the form. The bodies
 * are the same `connect-core` the company flow runs.
 */
export async function verifyBankAdminAction(
  _previous: VerifyState,
  form: FormData,
): Promise<VerifyState> {
  await requireArea('admin');
  const companyId = textField(form, 'companyId');
  if (companyId === '') {
    return { step: 'error', groupKey: 'bank', message: 'Empresa inválida.' };
  }
  return verifyBankCore(companyId, form);
}

export async function connectBankAdminAction(
  _previous: ConnectState,
  form: FormData,
): Promise<ConnectState> {
  await requireArea('admin');
  const companyId = textField(form, 'companyId');
  if (companyId === '') return { step: 'error', message: 'Empresa inválida.' };

  const result = await connectBankCore(companyId, form);
  if (result.step === 'done') revalidatePath(`/admin/companies/${companyId}`);
  return result;
}
