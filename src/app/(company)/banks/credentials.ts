/**
 * The wire between the credentials form and the actions that read it.
 *
 * A bank asks for credentials in **groups**, one per service, and every field is
 * named `<groupKey>.<field>` — `confirmation.clientId`, `consulta.clientSecret`.
 * That convention is the contract between a client component and a server
 * action, which is exactly the kind of thing that gets written twice and then
 * drifts on one side only. It is written here once: the form builds names with
 * `credentialFieldName`, the actions read them back with `readCredentialPair`,
 * and neither spells the dot itself.
 *
 * Pure, so the client component and the route handler may both import it.
 */
import type {
  BankCredentialGroup,
  BankCredentials,
} from '../../../application/ports/bank-gateway.ts';
import { secretField, textField } from '../../_lib/inputs.ts';

/** `confirmation.clientId`, `consulta.clientSecret` — one flat key per field. */
export function credentialFieldName(groupKey: string, field: string): string {
  return `${groupKey}.${field}`;
}

/** One credential pair, read from the fields the form named for that group. */
export function readCredentialPair(form: FormData, groupKey: string): BankCredentials {
  return {
    clientId: textField(form, credentialFieldName(groupKey, 'clientId')),
    clientSecret: secretField(form, credentialFieldName(groupKey, 'clientSecret')),
  };
}

/**
 * The group keys a form carries, for the action that does not know the bank —
 * "cambiar credenciales" acts on an account whose bank only the use case
 * resolves, so it harvests whatever pairs arrived and lets the use case judge
 * them against the account's declared groups.
 */
export function credentialGroupKeysIn(form: FormData): readonly string[] {
  const keys = new Set<string>();
  for (const [name] of form.entries()) {
    const dot = name.indexOf('.');
    if (dot === -1) continue;
    const field = name.slice(dot + 1);
    if (field === 'clientId' || field === 'clientSecret') keys.add(name.slice(0, dot));
  }
  return [...keys];
}

/**
 * Whether every required group is filled — the realtime gate on the submit
 * button, so an empty submit is never even offered.
 */
export function requiredCredentialsFilled(
  groups: readonly BankCredentialGroup[],
  values: Record<string, string>,
): boolean {
  return groups
    .filter((group) => group.required)
    .every((group) =>
      group.fields.every(
        (field) => (values[credentialFieldName(group.key, field.name)] ?? '').trim() !== '',
      ),
    );
}
