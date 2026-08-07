/**
 * The one way a bank adapter reaches a bank.
 *
 * Two decisions live here instead of in each adapter, because getting either
 * one wrong is a money bug rather than a bug. Nothing is ever served from a
 * cache, and a call that does not answer quickly is abandoned rather than held
 * open: a cashier is standing at a counter with a customer in front of them,
 * and work that takes longer than a few seconds belongs on the queue.
 *
 * Nothing here throws for an HTTP status. A 500 from the bank is an answer, and
 * the adapter that asked the question is the only code that knows what it
 * means.
 */

/** Past this the counter has already given up, so we should too. */
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Exactly one. A bank that failed twice inside the same second is having an
 * outage, and a third attempt only spends the cashier's patience — the retry
 * that is allowed to wait belongs on the queue, not on this request.
 */
const DEFAULT_RETRIES = 1;

export type BankHttpOutcome =
  /** The bank answered, whatever the status. `body` is raw text, unparsed. */
  | { readonly kind: 'http'; readonly status: number; readonly body: string }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
  /** DNS, TLS, connection refused: we never reached the bank at all. */
  | { readonly kind: 'network'; readonly detail: string };

export type BankFetchOptions = {
  timeoutMs?: number;
  retries?: number;
};

/**
 * `init.cache` and `init.signal` are set here and any caller value for them is
 * ignored — they are the two things this helper exists to guarantee.
 */
export async function bankFetch(
  url: string,
  init: RequestInit,
  options: BankFetchOptions = {},
): Promise<BankHttpOutcome> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const attempts = 1 + Math.max(0, options.retries ?? DEFAULT_RETRIES);

  let outcome = await attempt(url, init, timeoutMs);
  for (let tries = 1; tries < attempts && isTransient(outcome); tries++) {
    outcome = await attempt(url, init, timeoutMs);
  }
  return outcome;
}

/** Parses a body without throwing. `undefined` means "not JSON", for zod to reject. */
export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

async function attempt(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<BankHttpOutcome> {
  // A fresh signal per attempt: one that has already fired stays fired, so a
  // shared signal would abort the retry before it left the isolate.
  const signal = AbortSignal.timeout(timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      // A bank's answer is never cacheable. A replayed "yes, that reference
      // arrived" is a second charge on the same money.
      cache: 'no-store',
      signal,
    });

    // Text, not JSON: half of what a bank returns on a bad day is an HTML
    // error page from something in front of it, and the adapter parses with
    // zod anyway. Draining the body here also releases the connection.
    return { kind: 'http', status: response.status, body: await response.text() };
  } catch (error) {
    // Ask the signal rather than the error's name: workerd, undici and a test
    // double disagree on whether an expired timeout is an AbortError or a
    // TimeoutError, and they all agree on this.
    if (signal.aborted) return { kind: 'timeout', timeoutMs };
    return { kind: 'network', detail: describe(error) };
  }
}

function isTransient(outcome: BankHttpOutcome): boolean {
  // A timeout or a 5xx can be one bad node behind the bank's balancer, so it
  // is worth one more try. A transport error is our egress or their allowlist:
  // the same call a millisecond later fails the same way, and retrying it only
  // delays the honest answer.
  return outcome.kind === 'timeout' || (outcome.kind === 'http' && outcome.status >= 500);
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
