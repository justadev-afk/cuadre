'use server';

/**
 * Employee mutations. The company id comes from the session on every one — a
 * form that carried it could be pointed at another merchant's cashier, and the
 * whole area is scoped by the boundary the session draws.
 */
import { revalidatePath } from 'next/cache';

import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { secretField, textField } from '../../_lib/inputs.ts';
import type { CreateEmployeeState } from './form-state.ts';

const CREATE_MESSAGES: Record<string, string> = {
  username_taken: 'Ya existe un cajero con ese usuario en tu empresa.',
  invalid_username: 'El usuario admite minúsculas, números, punto, guion y guion bajo (3–32).',
  weak_pin: 'El PIN debe tener 4 a 6 dígitos y no ser una secuencia obvia.',
};

export async function createEmployeeAction(
  _previous: CreateEmployeeState,
  form: FormData,
): Promise<CreateEmployeeState> {
  const { companyId } = await requireCompany();

  const name = textField(form, 'name');
  const username = textField(form, 'username');
  const pin = secretField(form, 'pin');
  if (name === '' || username === '' || pin === '') {
    return { error: 'Completa el nombre, el usuario y el PIN.', ok: false };
  }

  const result = await container().employees.createEmployee({ companyId, name, username, pin });
  if (!result.ok) return { error: CREATE_MESSAGES[result.error] ?? 'No se pudo crear.', ok: false };

  revalidatePath('/employees');
  return { error: null, ok: true };
}

/**
 * Delete revokes access immediately and keeps every validation the person ran
 * — the repository does not cascade, and the use case reports which ending it
 * was. Bound to a plain form, so it works without client JS; the userId is a
 * hidden field the row supplies.
 */
export async function deleteEmployeeAction(form: FormData): Promise<void> {
  const { companyId } = await requireCompany();
  const userId = textField(form, 'userId');
  if (userId === '') return;

  await container().employees.deleteEmployee({ companyId, userId });
  revalidatePath('/employees');
}
