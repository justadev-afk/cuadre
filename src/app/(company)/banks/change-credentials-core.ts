/**
 * The shared body of "cambiar credenciales", used by both the company action
 * (`banks/actions.ts`) and the admin one (`admin/companies/[slug]/actions.ts`).
 *
 * It is a plain module, not a `'use server'` file: those may only export async
 * server actions, and this is a helper the two actions call after each has run
 * its own guard and resolved the `companyId` it is allowed to touch. Which bank
 * an account is on decides the credential-group keys, and the action does not
 * know the bank — so the credential pairs are harvested generically from the
 * form (`<groupKey>.clientId` / `<groupKey>.clientSecret`) and the use case
 * validates them against the account's declared groups.
 */
import type { AccountCredentials } from '../../../application/banking/account-credentials.ts';
import { container } from '../../_lib/current-session.ts';
import { secretField, textField } from '../../_lib/inputs.ts';
import type { ChangeCredentialsState } from './form-state.ts';

const MESSAGES: Record<string, string> = {
  rejected_credentials:
    'El banco rechazó estas credenciales. Revisa el Client ID y el Client Secret.',
  environment_mismatch: 'Estas credenciales no son del entorno de la cuenta.',
  no_accounts: 'Las credenciales son válidas, pero el banco no reporta cuentas.',
  maintenance: 'El banco está en mantenimiento. Intenta de nuevo en un rato.',
  unavailable: 'El banco no pudo responder. Intenta de nuevo.',
  timeout: 'El banco tardó demasiado. Intenta de nuevo.',
  invalid_input: 'Escribe el Client ID y el Client Secret.',
  not_found: 'No encontramos esa cuenta.',
};

/** Every `<groupKey>.clientId` / `<groupKey>.clientSecret` pair the form carries. */
function readCredentialGroups(form: FormData): AccountCredentials {
  const groupKeys = new Set<string>();
  for (const [name] of form.entries()) {
    const dot = name.indexOf('.');
    if (dot === -1) continue;
    const field = name.slice(dot + 1);
    if (field === 'clientId' || field === 'clientSecret') groupKeys.add(name.slice(0, dot));
  }

  const credentials: AccountCredentials = {};
  for (const key of groupKeys) {
    credentials[key] = {
      clientId: textField(form, `${key}.clientId`),
      clientSecret: secretField(form, `${key}.clientSecret`),
    };
  }
  return credentials;
}

/**
 * Runs the change for a company already resolved by the caller's guard.
 * Revalidation is the caller's — a company revalidates `/banks`, an admin the
 * company-detail path — so this stays free of the route it was reached from.
 */
export async function changeBankCredentialsCore(
  companyId: string,
  form: FormData,
): Promise<ChangeCredentialsState> {
  const accountId = textField(form, 'accountId');
  if (accountId === '') return { ok: false, error: 'Cuenta inválida.' };

  const credentials = readCredentialGroups(form);
  const result = await container().banking.changeBankCredentials({
    companyId,
    accountId,
    credentials,
  });
  if (!result.ok) {
    return {
      ok: false,
      error: MESSAGES[result.error] ?? 'No se pudieron cambiar las credenciales.',
    };
  }
  return { ok: true, error: null };
}
