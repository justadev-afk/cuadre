'use server';

/**
 * Create a company and its first `company` user, in one step (screen 07).
 *
 * The slug is the primary key and is immutable — the use case enforces that,
 * and this action never offers a way to change one. Every failure the use case
 * can return maps to a field-level Spanish message here; nothing is swallowed
 * into a generic error, because the operator needs to know whether it was the
 * slug, the RIF or the email that collided.
 */
import { revalidatePath } from 'next/cache';

import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { secretField, textField } from '../../_lib/inputs.ts';
import type { CreateCompanyState } from './form-state.ts';

const MESSAGES: Record<string, string> = {
  slug_taken: 'Ya existe una empresa con ese código.',
  rif_taken: 'Ya existe una empresa con ese RIF.',
  email_taken: 'Ese correo ya pertenece a otro usuario.',
  invalid_slug: 'El código solo admite minúsculas, números y guiones (3–32).',
  invalid_rif: 'El RIF no es válido. Revisa el dígito verificador.',
  weak_password: 'La contraseña temporal debe tener al menos 8 caracteres.',
};

export async function createCompanyAction(
  _previous: CreateCompanyState,
  form: FormData,
): Promise<CreateCompanyState> {
  await requireArea('admin');

  const input = {
    slug: textField(form, 'slug'),
    name: textField(form, 'name'),
    rif: textField(form, 'rif'),
    industry: textField(form, 'industry') || null,
    admin: {
      name: textField(form, 'adminName'),
      email: textField(form, 'adminEmail'),
      password: secretField(form, 'adminPassword'),
    },
  };

  if (
    input.slug === '' ||
    input.name === '' ||
    input.rif === '' ||
    input.admin.name === '' ||
    input.admin.email === '' ||
    input.admin.password === ''
  ) {
    return { error: 'Completa todos los campos obligatorios.', ok: false };
  }

  const result = await container().companies.createCompany(input);
  if (!result.ok) {
    return { error: MESSAGES[result.error] ?? 'No se pudo crear la empresa.', ok: false };
  }

  revalidatePath('/admin/companies');
  return { error: null, ok: true };
}
