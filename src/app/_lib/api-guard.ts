/**
 * The guard and the answer shape every mutation endpoint under `/api` shares.
 *
 * The mutations used to be Server Actions. They are route handlers now: a
 * handler is a request in and a `Response` out, which is a contract the
 * framework cannot half-finish. An action that never resolves leaves the browser
 * holding a spinner over work the server already committed — which is exactly
 * what a merchant watched happen with a bank connection that *was* saved.
 *
 * Two rules hold everywhere below:
 *
 *  - **A refusal is a 200 with `{ ok: false, error }`.** The forms render that
 *    error; it is the same `ActionState` the dialogs already react to, so the
 *    client half of a screen did not have to be rewritten to move off actions.
 *  - **A caller who may not be here is a 401**, and a 401 signs the browser out.
 *    Not a redirect: an endpoint that answers a `fetch` with an HTML login page
 *    is a page the caller parses as JSON and reports as "algo falló".
 *
 * `requireApi` never redirects, which is the whole difference from
 * `area-guard.ts`. A page can redirect because a person is looking at it; an
 * endpoint answers a script.
 */
import type { ResolvedSession } from '../../application/auth/resolve-session.ts';
import { type Area, canReach } from '../../application/session.ts';
import { currentSession } from './current-session.ts';
import { isLiveSession } from './session-exit.ts';

/** What the client reads off a 401 to know it must stop and sign out. */
export const SIGNED_OUT_ERROR = 'Tu sesión ya no está activa. Entra de nuevo.';

/**
 * The guard's two endings. A handler writes
 * `if (!guard.ok) return guard.response;` and carries on with a session it
 * knows is live — no `!` and no cast anywhere below it.
 */
export type ApiGuard =
  | { readonly ok: true; readonly resolved: ResolvedSession }
  | { readonly ok: false; readonly response: Response };

/** A company-scoped guard also answers *whose* data this call may touch. */
export type CompanyGuard =
  | { readonly ok: true; readonly resolved: ResolvedSession; readonly companyId: string }
  | { readonly ok: false; readonly response: Response };

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // These are answers about one session's data. No shared cache may keep
      // them, and no browser may replay one from bfcache after a sign-out.
      'cache-control': 'no-store',
    },
  });
}

/** `{ ok: false, error }` — a refusal the form shows, never an HTTP error. */
export function refusal(error: string): Response {
  return jsonResponse({ ok: false, error });
}

/**
 * The 401. `signedOut` is the flag the client hook keys on: it stops treating
 * the reply as a form error and sends the browser to `/session-ended`, which
 * clears the cookie and explains itself.
 */
export function unauthorised(): Response {
  return jsonResponse({ ok: false, error: SIGNED_OUT_ERROR, signedOut: true }, 401);
}

/** A live session that may not act here. Distinct from "not signed in". */
export function forbidden(): Response {
  return jsonResponse({ ok: false, error: 'No tienes permiso para hacer eso.' }, 403);
}

/**
 * The session behind an endpoint call, or the 401 that ends it.
 *
 * Anonymous, superseded and **revoked** all collapse to one answer here: the
 * caller has no session this request may use. The client turns that into a sign
 * out, so a deleted cashier's till stops working on its next call rather than
 * whenever KV happens to catch up.
 */
export async function requireApi(area: Area): Promise<ApiGuard> {
  const resolution = await currentSession();
  if (!isLiveSession(resolution)) return { ok: false, response: unauthorised() };

  const { active } = resolution;
  if (!canReach(active.session.role, area)) return { ok: false, response: forbidden() };
  return { ok: true, resolved: active };
}

/**
 * The company area's endpoints: the guard plus the id every query below it is
 * scoped by. `companyId` is null only for a platform admin, whom `canReach` has
 * already refused — the branch exists so the impossible case is a 401 rather
 * than an assertion.
 */
export async function requireApiCompany(): Promise<CompanyGuard> {
  const guard = await requireApi('company');
  if (!guard.ok) return guard;

  const companyId = guard.resolved.session.companyId;
  if (companyId === null) return { ok: false, response: unauthorised() };
  return { ok: true, resolved: guard.resolved, companyId };
}

/**
 * The two callers of the bank and company-scoped endpoints: a merchant acting on
 * itself, and a platform admin acting on a merchant during the alta.
 *
 * The admin's target company comes off the form, and *only* an admin's does. A
 * merchant's own id is read from the session and a `companyId` field in their
 * request is ignored — which is the whole reason this is one function rather
 * than a parameter each handler remembers to pass.
 */
export async function requireCompanyScope(form: FormData): Promise<CompanyGuard> {
  const resolution = await currentSession();
  if (!isLiveSession(resolution)) return { ok: false, response: unauthorised() };

  const { active } = resolution;
  if (active.session.role === 'admin') {
    const target = String(form.get('companyId') ?? '').trim();
    if (target === '') return { ok: false, response: refusal('Empresa inválida.') };
    return { ok: true, resolved: active, companyId: target };
  }

  if (!canReach(active.session.role, 'company')) return { ok: false, response: forbidden() };
  const companyId = active.session.companyId;
  if (companyId === null) return { ok: false, response: unauthorised() };
  return { ok: true, resolved: active, companyId };
}

/** The body of a form POST. A request that is not one is a client bug, not a form. */
export async function formOf(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}
