/**
 * `POST /api/banks/test` — "Probar credenciales": ask the bank, away from the
 * counter, whether a connection's stored credentials still open a session.
 *
 * The panel's lever, never the till's: `requireCompanyScope` admits a company
 * owner (their own company) and a platform admin (the one named in the form),
 * and refuses a cashier. Nothing is re-typed — `reverifyBankAccount` unseals what
 * is stored, authenticates, and re-stamps `verified_at` on success.
 *
 * A refusal carries the adapter's diagnostic — environment, step, HTTP status,
 * the bank's code — because the whole point of pressing this is to have
 * something to read out to the bank's desk.
 */

import { formOf, jsonResponse, refusal, requireCompanyScope } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { textField } from '../../../_lib/inputs.ts';
import { bankFailureMessage } from '../../../(company)/banks/bank-messages.ts';

export async function POST(request: Request): Promise<Response> {
  const form = await formOf(request);
  if (form === null) return refusal('No se pudo leer el formulario.');

  const scope = await requireCompanyScope(form);
  if (!scope.ok) return scope.response;

  const accountId = textField(form, 'accountId');
  if (accountId === '') return refusal('Cuenta inválida.');

  const result = await container().banking.reverifyBankAccount({
    companyId: scope.companyId,
    accountId,
  });
  if (!result.ok) {
    const { failure, diagnostic } = result.error;
    const message = bankFailureMessage(failure);
    return refusal(diagnostic === null ? message : `${message} (${diagnostic})`);
  }

  return jsonResponse({ ok: true, error: null });
}
