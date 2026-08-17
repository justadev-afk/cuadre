/**
 * `POST /api/employees/status` — taking someone's access away, or giving it back.
 *
 * **Nothing here deletes a user, and nothing anywhere else does either.**
 * `validations.cashier_id` names whoever confirmed each payment and has to keep
 * naming them years later, so access is a column: `disabled` ends the next
 * sign-in *and* the sessions already open, and `active` hands it back. That is
 * the whole lever a merchant has over a person, and it is reversible, which the
 * old delete was not.
 *
 * A disabled user stops working immediately rather than eventually: the use case
 * sweeps their sessions out of KV, and `resolveSession` re-reads this very
 * column on every authenticated request — so a till already open answers 401 on
 * its next call and signs itself out.
 */
import { jsonResponse, refusal, requireApiCompany } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { textField } from '../../../_lib/inputs.ts';

const MESSAGES: Record<string, string> = {
  not_found: 'No se encontró ese usuario.',
  last_administrator: 'No puedes dejar la empresa sin administrador.',
  own_access: 'No puedes desactivar tu propio usuario.',
};

/** What the panel says once it is done. */
const NOTE = {
  disabled: 'Se desactivó el usuario. Ya no puede entrar y sus validaciones se conservan.',
  active: 'Se reactivó el usuario.',
} as const;

export async function POST(request: Request): Promise<Response> {
  const guard = await requireApiCompany();
  if (!guard.ok) return guard.response;

  const form = await request.formData();
  const userId = textField(form, 'userId');
  if (userId === '') return refusal('Usuario inválido.');

  // Anything that is not the word that re-opens a door closes it. A malformed
  // field must never be the one that grants access.
  const status = textField(form, 'status') === 'active' ? 'active' : 'disabled';

  const result = await container().employees.updateEmployee({
    companyId: guard.companyId,
    userId,
    // Off the session, never off the form: the rule it feeds is "nobody switches
    // off their own access", and an actor read from the body is an actor the
    // caller chooses.
    actorUserId: guard.resolved.session.userId,
    status,
  });
  if (!result.ok) return refusal(MESSAGES[result.error] ?? 'No se pudo cambiar el acceso.');

  return jsonResponse({ ok: true, error: null, note: NOTE[status] });
}
