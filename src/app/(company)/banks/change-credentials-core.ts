/**
 * The shared body of "cambiar credenciales", called by `api/banks/credentials`
 * for whichever company the guard resolved — a merchant's own, or the one a
 * platform admin is setting up.
 *
 * Which bank an account is on decides the credential-group keys, and this does
 * not know the bank — so the credential pairs are harvested generically from the
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
