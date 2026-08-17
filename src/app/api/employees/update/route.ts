/**
 * `POST /api/employees/update` — editing one of the merchant's own people.
 *
 * Their name always; their PIN only when a new one is typed, because blank means
 * "leave it alone" and a cashier's PIN is the one credential a shop can reset
 * without an inbox. A `company` user has a password rather than a PIN, so the
 * dialog does not offer the field and this never sends one — the use case would
 * refuse it as `not_a_cashier` if it did.
 *
 * The username is half of the login tuple and never changes. It is not read
 * here at all, so it cannot be changed by adding a field to a hand-built post.
 */
import { jsonResponse, refusal, requireApiCompany } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { secretField, textField } from '../../../_lib/inputs.ts';

const MESSAGES: Record<string, string> = {
  not_found: 'No se encontró ese usuario.',
  own_access: 'No puedes cambiar tu propio acceso.',
  weak_pin: 'El PIN debe tener 4 a 6 dígitos y no ser una secuencia obvia.',
  not_a_cashier: 'Solo se le puede poner PIN a un cajero.',
  last_administrator: 'No puedes dejar la empresa sin administrador.',
};

export async function POST(request: Request): Promise<Response> {
  const guard = await requireApiCompany();
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const userId = textField(form, 'userId');
  const name = textField(form, 'name');
  const pin = secretField(form, 'pin');
  if (userId === '' || name === '') return refusal('Completa el nombre.');

  const result = await container().employees.updateEmployee({
    companyId: guard.companyId,
    userId,
    actorUserId: guard.resolved.session.userId,
    name,
    ...(pin === '' ? {} : { pin }),
  });
  if (!result.ok) return refusal(MESSAGES[result.error] ?? 'No se pudo guardar.');

  return jsonResponse({ ok: true, error: null });
}
