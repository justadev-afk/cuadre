/**
 * `BANESCO_DEBUG=true` — print what we actually put on the wire.
 *
 * It exists because of a sentence in a meeting: *"no estamos recibiendo el
 * código del banco ni el teléfono"*. Arguing about that from the code is slow
 * and from a log line is worse; showing the exact method, path and body settles
 * it in one request. So this prints those three, plus the bank's answer, and
 * nothing else.
 *
 * **Local only.** The flag is a var in `.dev.vars` and is deliberately absent
 * from `wrangler.toml`, so a deploy cannot turn it on by accident: bodies here
 * carry a customer's phone and reference in the clear, which is fine on a
 * laptop and is not fine in Workers Logs. The one thing never printed even
 * locally is a credential — `oauth.client.ts` redacts its secret before calling
 * this (§8: a secret never reaches a log, whatever the flag says).
 */
import { debugLine } from '../../../shared/logger.ts';
import { BANESCO_ID } from './endpoints.ts';

export type BanescoDebugCall = {
  readonly method: string;
  readonly url: string;
  /** The request body, already serialised. Omitted when printing a response. */
  readonly body?: string;
  /** Present on the reply half of the pair. */
  readonly status?: number;
  readonly response?: string;
};

export function debugBanescoCall(enabled: boolean, call: BanescoDebugCall): void {
  if (!enabled) return;

  // The path, not the URL: the QA hostnames are 80 characters of OpenShift
  // cluster name and reading past them is the whole difficulty of reading these.
  const path = pathOf(call.url);
  const head =
    call.status === undefined
      ? `→ ${call.method} ${path}`
      : `← ${call.status} ${call.method} ${path}`;

  debugLine(BANESCO_ID, head, pretty(call.body ?? call.response));
}

function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

/** JSON if it is JSON, the raw text if the bank sent an error page. */
function pretty(body: string | undefined): string | undefined {
  if (body === undefined || body === '') return undefined;
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
