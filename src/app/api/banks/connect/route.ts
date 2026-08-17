/**
 * `POST /api/banks/connect` — the alta of a bank connection.
 *
 * One endpoint for the two callers that ask the same thing: a merchant
 * connecting its own bank from `/banks`, and a platform admin connecting one
 * *for* a merchant during the initial setup. They were two Server Actions over
 * one shared core; the core is unchanged and the pair of wrappers is gone —
 * `requireCompanyScope` is what tells "my company" from "the company this admin
 * named", and it is the only place that reads a `companyId` off a form.
 *
 * A refusal — bad credentials, a bank that says no — is a 200 with
 * `{ ok: false, error }`, because the wizard shows it as a toast and the
 * connection simply did not happen. The bank round trip inside can take seconds;
 * what it can no longer do is finish and leave the browser waiting, which is
 * what moved this off a Server Action.
 */

import { formOf, jsonResponse, refusal, requireCompanyScope } from '../../../_lib/api-guard.ts';
import { connectBankCore } from '../../../(company)/banks/connect-core.ts';

export async function POST(request: Request): Promise<Response> {
  const form = await formOf(request);
  if (form === null) return refusal('No se pudo leer el formulario.');

  const scope = await requireCompanyScope(form);
  if (!scope.ok) return scope.response;

  return jsonResponse(await connectBankCore(scope.companyId, form));
}
