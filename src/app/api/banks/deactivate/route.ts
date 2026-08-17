/**
 * `POST /api/banks/deactivate` — a company turns a connected bank off.
 *
 * Soft, always: `removeBankAccount` sets the status and never deletes, so the
 * validations that name this connection keep resolving and the bank can be
 * connected again later.
 */
import { formOf, jsonResponse, refusal, requireCompanyScope } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { textField } from '../../../_lib/inputs.ts';

export async function POST(request: Request): Promise<Response> {
  const form = await formOf(request);
  if (form === null) return refusal('No se pudo leer el formulario.');

  const scope = await requireCompanyScope(form);
  if (!scope.ok) return scope.response;

  const accountId = textField(form, 'accountId');
  if (accountId === '') return refusal('Cuenta inválida.');

  const result = await container().banking.removeBankAccount({
    companyId: scope.companyId,
    accountId,
  });
  if (!result.ok) return refusal('No se pudo desactivar el banco.');

  return jsonResponse({ ok: true, error: null });
}
