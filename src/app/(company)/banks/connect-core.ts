/**
 * The shared body of connecting a bank, for a company the caller has already
 * resolved and guarded.
 *
 * A plain module, not a `'use server'` file: those may export only async server
 * actions, and this is the logic two of them share. The company action
 * (`banks/actions.ts`) runs `requireCompany` and passes its own company; the
 * admin action (`admin/companies/[slug]/actions.ts`) runs `requireArea('admin')`
 * and passes the target company. Revalidation is the caller's — a company
 * revalidates `/banks`, an admin the company-detail path — so this stays free of
 * the route it was reached from.
 *
 * It used to be two functions, verify then connect, with a KV-parked
 * verification in between while the merchant chose a receiving account. There is
 * no account to choose any more (see `connect-bank-account.ts`), so there is one
 * function and one round trip.
 *
 * A bank asks for credentials in **groups**, one per service; nothing here names
 * a bank, so the same code serves whatever the catalogue declares.
 */
import type { AccountCredentials } from '../../../application/banking/account-credentials.ts';
import { logger } from '../../../shared/logger.ts';
import { container } from '../../_lib/current-session.ts';
import { textField } from '../../_lib/inputs.ts';
import { bankFailureMessage } from './bank-messages.ts';
import { readCredentialPair } from './credentials.ts';
import type { ConnectState } from './form-state.ts';

export async function connectBankCore(companyId: string, form: FormData): Promise<ConnectState> {
  const environment = textField(form, 'environment') === 'sandbox' ? 'sandbox' : 'production';

  // Nothing below may throw its way out to a 500: a bank call that faults is an
  // expected outcome the wizard shows as a toast, so any unforeseen throw is
  // caught and turned into the same kind of error state as a clean refusal.
  try {
    const services = container().banking;

    // The bank comes from the picker, not a literal: look it up in the catalogue
    // and refuse anything that is not a bank we support. Its own declaration is
    // then the list of credential pairs to read — nothing here names a service.
    const bankId = textField(form, 'bank');
    const bank = services.listSupportedBanks().find((b) => b.id === bankId);
    if (bank === undefined) {
      return { ok: false, groupKey: 'bank', error: 'Ese banco no está disponible.' };
    }

    const credentials: AccountCredentials = {};
    for (const group of bank.credentialGroups) {
      const pair = readCredentialPair(form, group.key);
      const bothFilled = pair.clientId !== '' && pair.clientSecret !== '';
      const halfFilled = !bothFilled && (pair.clientId !== '' || pair.clientSecret !== '');

      if (group.required && !bothFilled) {
        return {
          ok: false,
          groupKey: group.key,
          error: `Escribe el Client ID y el Client Secret de ${group.label}.`,
        };
      }
      if (halfFilled) {
        return {
          ok: false,
          groupKey: group.key,
          error: `Completa el Client ID y el Client Secret de ${group.label}, o deja ambos vacíos.`,
        };
      }
      if (bothFilled) credentials[group.key] = pair;
    }

    const result = await services.connectBankAccount({
      companyId,
      bank: bank.id,
      environment,
      label: textField(form, 'label'),
      // One per line, because a merchant with three receiving accounts should
      // not have to add three fields. Empty is a merchant who only takes pago
      // móvil, which is a normal shape rather than a missing answer.
      receivingAccounts: textField(form, 'receivingAccounts')
        .split(/[\n,]/)
        .map((account) => account.trim())
        .filter((account) => account !== ''),
      credentials,
    });

    if (!result.ok) {
      return { ok: false, error: bankFailureMessage(result.error, bank.displayName) };
    }
    return { ok: true, error: null };
  } catch (error) {
    logger.error('connect_bank_core_unexpected', {
      companyId,
      err: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, error: 'Algo falló al conectar el banco. Intenta de nuevo.' };
  }
}
