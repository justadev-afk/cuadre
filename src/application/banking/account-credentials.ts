/**
 * The credential pairs a connected bank runs on, in two shapes.
 *
 * `AccountCredentials` is the *input* map — what the onboarding form collected:
 * a plain map from a bank's credential-group key to that pair. A bank may run on
 * one pair or several, and the map names no bank and no fixed service. `connect`
 * and `change` seal it into per-pair rows (see `bank-account.repository.ts`).
 *
 * It is also what is *stored*: the whole map is sealed as one JSON value on
 * `bank_accounts.creds_ct`, so what `validate` and `reverify` unseal is this
 * same shape rather than a list of rows.
 *
 * Neither side reads a pair by guessing keys. A caller that needs "the pair the
 * counter runs on" asks `operateCredential(opened, gateway.operateKey)`, and
 * that key is declared once, in the adapter.
 */
import type { BankCredentials } from '../ports/bank-gateway.ts';

/** Keyed by `BankCredentialGroup.key`. Present keys are the pairs that were given. */
export type AccountCredentials = Record<string, BankCredentials>;

/**
 * The pair the counter runs on, or `null` when the connection holds none.
 *
 * The pair stored under the gateway's `operateKey` — or, for a connection that
 * holds exactly one pair, that lone pair whatever it is keyed as. The fallback
 * is what lets a seeded or hand-written row work without knowing the adapter's
 * spelling, and it cannot be ambiguous: there is only one pair to choose.
 */
export function operateCredential(
  opened: AccountCredentials,
  operateKey: string,
): BankCredentials | null {
  return lone(opened, operateKey);
}

/** The pair under `key`, or — for a connection holding exactly one — that one. */
function lone(opened: AccountCredentials, key: string): BankCredentials | null {
  const named = opened[key];
  if (named !== undefined) return named;

  const all = Object.values(opened);
  return all.length === 1 ? (all[0] ?? null) : null;
}
