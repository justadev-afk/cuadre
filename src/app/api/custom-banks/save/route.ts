/**
 * `POST /api/custom-banks/save` — a custom payer brand created or edited.
 * Platform team only.
 *
 * One endpoint for both, because they ask the merchant — the admin, here — for
 * exactly the same four things (§11). `creating` is the only difference and it
 * decides one thing: whether a code that already exists is a collision to report
 * or the row being edited.
 *
 * Every refusal names the field that caused it. An admin filling in a routing
 * rule that decides where a payment question is sent needs to know whether it
 * was the code, the target bank or the phone — folding all three into "no se
 * pudo guardar" would leave them changing values at random.
 */
import { jsonResponse, refusal, requireApi } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { checkedField, textField } from '../../../_lib/inputs.ts';

const MESSAGES: Record<string, string> = {
  invalid_code:
    'El código debe empezar por una letra y llevar solo minúsculas, números y guiones (2–24).',
  invalid_name: 'El nombre es obligatorio y admite hasta 40 caracteres.',
  invalid_target_bank: 'Elige el banco real al que se envía la consulta.',
  invalid_phone: 'Ese teléfono no es un móvil venezolano válido.',
  code_taken: 'Ya existe un banco con ese código.',
  not_found: 'Ese banco ya no existe.',
};

export async function POST(request: Request): Promise<Response> {
  const guard = await requireApi('admin');
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const result = await container().customBanks.saveCustomPayerBank({
    code: textField(form, 'code'),
    name: textField(form, 'name'),
    targetBankId: textField(form, 'targetBankId'),
    // Empty is a value: "ask with the phone the cashier typed".
    targetPhone: textField(form, 'targetPhone'),
    status: checkedField(form, 'active') ? 'active' : 'disabled',
    creating: checkedField(form, 'creating'),
  });

  if (!result.ok) return refusal(MESSAGES[result.error] ?? 'No se pudo guardar el banco.');
  return jsonResponse({ ok: true, error: null });
}
