/**
 * `POST /api/companies/create` — a company and its first `company` user, in one
 * step (screen 07). Platform team only.
 *
 * The slug is the primary key and is immutable — the use case enforces it, and
 * nothing here offers a way to change one. Every failure the use case can return
 * maps to its own Spanish message: the operator needs to know whether it was the
 * slug, the RIF or the email that collided, so nothing is folded into a generic
 * "no se pudo".
 */
import { jsonResponse, refusal, requireApi } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { secretField, textField } from '../../../_lib/inputs.ts';

const MESSAGES: Record<string, string> = {
  slug_taken: 'Ya existe una empresa con ese código.',
  rif_taken: 'Ya existe una empresa con ese RIF.',
  email_taken: 'Ese correo ya pertenece a otro usuario.',
  invalid_slug: 'El código solo admite minúsculas, números y guiones (3–32).',
  invalid_rif: 'El RIF no es válido. Revisa el dígito verificador.',
  weak_password: 'La contraseña temporal debe tener al menos 8 caracteres.',
};

export async function POST(request: Request): Promise<Response> {
  const guard = await requireApi('admin');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
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
    return refusal('Completa todos los campos obligatorios.');
  }

  const result = await container().companies.createCompany(input);
  if (!result.ok) return refusal(MESSAGES[result.error] ?? 'No se pudo crear la empresa.');

  return jsonResponse({ ok: true, error: null });
}
