/**
 * `POST /api/employees/create` — a merchant adds a cashier.
 *
 * The company id comes from the session on every employee endpoint. A form that
 * carried it could be pointed at another merchant's staff, and the whole area is
 * scoped by the boundary the session draws.
 */
import { jsonResponse, refusal, requireApiCompany } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { secretField, textField } from '../../../_lib/inputs.ts';

const MESSAGES: Record<string, string> = {
  username_taken: 'Ya existe un cajero con ese usuario en tu empresa.',
  invalid_username: 'El usuario admite minúsculas, números, punto, guion y guion bajo (3–32).',
  weak_pin: 'El PIN debe tener 4 a 6 dígitos y no ser una secuencia obvia.',
};

export async function POST(request: Request): Promise<Response> {
  const guard = await requireApiCompany();
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const name = textField(form, 'name');
  const username = textField(form, 'username');
  const pin = secretField(form, 'pin');
  if (name === '' || username === '' || pin === '') {
    return refusal('Completa el nombre, el usuario y el PIN.');
  }

  const result = await container().employees.createEmployee({
    companyId: guard.companyId,
    name,
    username,
    pin,
  });
  if (!result.ok) return refusal(MESSAGES[result.error] ?? 'No se pudo crear.');

  return jsonResponse({ ok: true, error: null });
}
