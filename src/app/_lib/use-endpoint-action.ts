'use client';

/**
 * `useActionState`, against an endpoint instead of a Server Action.
 *
 * It returns the same triple — `[state, submit, pending]` — and `submit` goes
 * straight into `<form action={submit}>`, so a screen moves off actions by
 * changing one import and one call. That symmetry is deliberate: the reason for
 * the move is the transport, not the shape of the forms.
 *
 * What it adds is the two things a `fetch` has to handle and an action never
 * did:
 *
 *  - **A 401 signs the browser out.** The endpoints answer `signedOut` when the
 *    session is gone — deleted user, suspended company, superseded cookie — and
 *    this sends the tab to `/session-ended`, which clears the cookie and lands
 *    on the login screen with an explanation. A till whose cashier was removed
 *    stops on its next call instead of carrying on against a dead session.
 *  - **A failed request is a refusal, not a hang.** No network, a 500, a reply
 *    that is not JSON: all of them end as `{ ok: false, error }` and the
 *    spinner comes down. Nothing here can leave a dialog spinning forever.
 *
 * Success refreshes the route by default, which is what `revalidatePath` did for
 * the actions: the server components above re-render with the row that was just
 * written. A form that navigates instead (sign-in) says `refresh: false` and
 * follows the `redirect` the endpoint returns.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';

import { SESSION_ENDED_PATH } from './session-exit.ts';

/** Every endpoint answers at least this. Handlers add their own fields. */
export type EndpointReply = {
  readonly error?: string | null;
  readonly ok?: boolean;
  /** The 401 flag. Set by `unauthorised()` and by nothing else. */
  readonly signedOut?: boolean;
  /** Where the browser must go next — sign-in and password reset use it. */
  readonly redirect?: string;
};

export type UseEndpointOptions = {
  /**
   * Re-render the current route on success. On by default: it is what replaced
   * `revalidatePath`, and a dialog that writes a row and closes over a stale
   * table is the bug that replacement exists to prevent.
   */
  readonly refresh?: boolean;
};

/** What the whole app shows when the request itself failed. */
const UNREACHABLE = 'No se pudo conectar. Revisa tu conexión e intenta de nuevo.';

export function useEndpointAction<S extends EndpointReply>(
  endpoint: string,
  initial: S,
  options: UseEndpointOptions = {},
): [S, (form: FormData) => void, boolean] {
  const router = useRouter();
  const [state, setState] = useState<S>(initial);
  const [pending, setPending] = useState(false);
  // A double submit (Enter with the button already spinning) must not fire the
  // request twice. `pending` is state and lags a render behind; this does not.
  const inFlight = useRef(false);

  const submit = useCallback(
    (form: FormData): void => {
      if (inFlight.current) return;
      inFlight.current = true;
      setPending(true);

      void (async () => {
        try {
          const reply = await postForm<S>(endpoint, form);

          // The session is gone. Nothing else on this page is worth doing.
          if (reply.signedOut === true) {
            window.location.assign(SESSION_ENDED_PATH);
            return;
          }

          setState(reply);

          if (typeof reply.redirect === 'string' && reply.redirect !== '') {
            // A full navigation, not a client one: the cookie this endpoint just
            // set has to reach the server render that follows.
            window.location.assign(reply.redirect);
            return;
          }

          if (reply.ok === true && options.refresh !== false) router.refresh();
        } finally {
          inFlight.current = false;
          setPending(false);
        }
      })();
    },
    [endpoint, options.refresh, router],
  );

  return [state, submit, pending];
}

/**
 * The JSON call, for the two screens that speak JSON rather than form fields —
 * the counter's charge and the cashier's list. It throws where the form hook
 * returns a refusal, because both callers already have a UI state for "no se
 * pudo" and neither renders an `ActionState`.
 *
 * A 401 does not resolve or reject: it navigates. The returned promise stays
 * pending on purpose — the browser is leaving the page, and settling it would
 * only let a caller paint an error over a screen that is already gone.
 */
export async function postJson<T>(endpoint: string, body: unknown): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    body: JSON.stringify(body),
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
  });

  if (response.status === 401) {
    window.location.assign(SESSION_ENDED_PATH);
    return new Promise<T>(() => {});
  }

  if (!response.ok) throw new Error(`${endpoint} answered ${response.status}`);
  return (await response.json()) as T;
}

/**
 * POST the form and read the reply.
 *
 * The FormData goes as-is — no `content-type` header, so the browser writes the
 * multipart boundary itself — and every failure the network can produce comes
 * back as the same refusal shape. `credentials: 'same-origin'` is the default
 * for a same-origin fetch and is stated anyway: the session cookie is the whole
 * authorisation of this call.
 */
async function postForm<S extends EndpointReply>(endpoint: string, form: FormData): Promise<S> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      body: form,
      credentials: 'same-origin',
      headers: { accept: 'application/json' },
    });

    const body = (await response.json()) as S;
    // A handler that fell over without a body of its own still has to come back
    // as something the form can show.
    if (typeof body !== 'object' || body === null) {
      return { ok: false, error: UNREACHABLE } as unknown as S;
    }
    return body;
  } catch {
    return { ok: false, error: UNREACHABLE } as unknown as S;
  }
}
