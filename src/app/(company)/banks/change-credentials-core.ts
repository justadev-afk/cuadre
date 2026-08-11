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
import { textField } from '../../_lib/inputs.ts';
import { bankFailureMessage } from './bank-messages.ts';
import { credentialGroupKeysIn, readCredentialPair } from './credentials.ts';
import type { ChangeCredentialsState } from './form-state.ts';

/**
 * Runs the change for a company already resolved by the caller's guard.
 * Revalidation is the caller's — a company revalidates `/banks`, an admin the
 * company-detail path — so this stays free of the route it was reached from.
 *
 * The dialog edits two things, so this writes two: the credentials (which cost
 * a bank round trip to prove) and the accounts that receive transferencias
 * (which cost nothing — they are the merchant's own numbers). The accounts are
 * written first and on their own terms: a merchant who only came to fix a
 * mistyped account should not have their edit thrown away because the bank was
 * having a bad minute.
 */
export async function changeBankCredentialsCore(
  companyId: string,
  form: FormData,
): Promise<ChangeCredentialsState> {
  const accountId = textField(form, 'accountId');
  if (accountId === '') return { ok: false, error: 'Cuenta inválida.' };

  const stored = await container().banking.setReceivingAccounts({
    companyId,
    bankAccountId: accountId,
    // One per line, as the chips field posts them.
    accounts: textField(form, 'receivingAccounts').split(/[\n,]/),
  });
  if (!stored.ok) return { ok: false, error: 'No se pudieron guardar las cuentas.' };

  // The action does not know the bank — the use case resolves it from the
  // account — so every pair the form carried is harvested and judged there.
  const credentials: AccountCredentials = {};
  for (const key of credentialGroupKeysIn(form)) credentials[key] = readCredentialPair(form, key);

  const result = await container().banking.changeBankCredentials({
    companyId,
    accountId,
    credentials,
  });
  if (!result.ok) return { ok: false, error: bankFailureMessage(result.error) };
  return { ok: true, error: null };
}
