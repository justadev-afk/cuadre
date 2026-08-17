/**
 * `POST /api/banks/credentials` — replacing a connection's credentials, and the
 * accounts that receive transferencias, in one submit.
 *
 * The same two callers as the alta (`../connect/route.ts`) and the same rule
 * about which company they may touch, so the guard is the same one. The body is
 * the shared core the two Server Actions used to wrap.
 */

import { formOf, jsonResponse, refusal, requireCompanyScope } from '../../../_lib/api-guard.ts';
import { changeBankCredentialsCore } from '../../../(company)/banks/change-credentials-core.ts';

export async function POST(request: Request): Promise<Response> {
  const form = await formOf(request);
  if (form === null) return refusal('No se pudo leer el formulario.');

  const scope = await requireCompanyScope(form);
  if (!scope.ok) return scope.response;

  return jsonResponse(await changeBankCredentialsCore(scope.companyId, form));
}
