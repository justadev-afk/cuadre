/**
 * What actually sits inside a connected account's sealed `credentials` blob: a
 * plain map from a bank's credential-group key to that pair.
 *
 * A bank may run on one credential pair or on several (Banesco splits its API
 * across two OAuth clients). Rather than fix a slot per service — which would
 * mean a schema change every time a bank adds one — the account stores whatever
 * pairs it was given as a keyed JSON object, sealed as one opaque blob. The
 * database sees a single sealed value; this map is its shape once opened, and it
 * names no bank and no fixed service.
 *
 * Nobody reads the map by guessing keys. A caller that needs "the pair the
 * counter runs on" asks `credentialsByUsage(gateway.credentialGroups, map,
 * 'operate')`: the gateway's own declaration says which key that is, so the
 * knowledge of what each pair is *for* stays in the adapter, not here.
 */
import type {
  BankCredentialGroup,
  BankCredentials,
  BankCredentialUsage,
} from '../ports/bank-gateway.ts';

/** Keyed by `BankCredentialGroup.key`. Present keys are the pairs that were given. */
export type AccountCredentials = Record<string, BankCredentials>;

/**
 * The credentials the gateway's group with this usage was stored under, or
 * `null` when the bank declares no such group or the map does not carry it.
 */
export function credentialsByUsage(
  groups: readonly BankCredentialGroup[],
  credentials: AccountCredentials,
  usage: BankCredentialUsage,
): BankCredentials | null {
  const group = groups.find((candidate) => candidate.usage === usage);
  if (group === undefined) return null;
  return credentials[group.key] ?? null;
}
