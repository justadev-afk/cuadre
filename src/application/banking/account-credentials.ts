/**
 * The credential pairs a connected account runs on, in two shapes.
 *
 * `AccountCredentials` is the *input* map — what the onboarding wizard collected
 * and parked in KV before anything was written: a plain map from a bank's
 * credential-group key to that pair. A bank may run on one pair or several
 * (Banesco splits its API across two OAuth clients), and the map names no bank
 * and no fixed service. `verify` parks it; `connect` and `change` seal it into
 * per-pair rows (see `bank-account.repository.ts`).
 *
 * `OpenedCredential` is one *stored* pair, unsealed for the length of a single
 * bank call — what `validate` and `reverify` hold after opening a row.
 *
 * Neither side reads a pair by guessing keys. A caller that needs "the pair the
 * counter runs on" asks `operateCredential(opened)`: the choice is the pair
 * stored with `operate` usage, or — for a bank with a single pair — that lone
 * pair whatever its usage says.
 */
import type { BankCredentials, BankCredentialUsage } from '../ports/bank-gateway.ts';

/** Keyed by `BankCredentialGroup.key`. Present keys are the pairs that were given. */
export type AccountCredentials = Record<string, BankCredentials>;

/** One stored credential pair, unsealed. */
export type OpenedCredential = {
  readonly credKey: string;
  readonly usage: BankCredentialUsage;
  readonly credentials: BankCredentials;
};

/**
 * The pair the counter runs on, or `null` when the account holds none.
 *
 * A bank with a single stored pair uses it for everything — so a lone pair is
 * the operate one whatever its `usage` says. Otherwise it is the pair stored
 * with `operate` usage. This is the whole per-bank branch, and it lives here,
 * not in a use case.
 */
export function operateCredential(opened: readonly OpenedCredential[]): BankCredentials | null {
  if (opened.length === 1) return opened[0]?.credentials ?? null;
  return opened.find((candidate) => candidate.usage === 'operate')?.credentials ?? null;
}
