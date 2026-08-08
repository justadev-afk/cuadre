/**
 * The shared bodies of the bank-onboarding flow — verify, then connect — for a
 * company the caller has already resolved and guarded.
 *
 * A plain module, not a `'use server'` file: those may export only async server
 * actions, and this is the logic two of them share. The company actions
 * (`banks/actions.ts`) run `requireCompany` and pass their own company;
 * the admin actions (`admin/companies/[slug]/actions.ts`) run `requireArea('admin')`
 * and pass the target company. Revalidation is the caller's — a company
 * revalidates `/banks`, an admin the company-detail path — so this stays free of
 * the route it was reached from.
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
import type { ConnectState, VerifyState } from './form-state.ts';

/** Step 1–2: read the picked bank's credential groups and verify them. */
export async function verifyBankCore(companyId: string, form: FormData): Promise<VerifyState> {
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
      return { step: 'error', groupKey: 'bank', message: 'Ese banco no está disponible.' };
    }

    const credentials: AccountCredentials = {};
    for (const group of bank.credentialGroups) {
      const pair = readCredentialPair(form, group.key);
      const bothFilled = pair.clientId !== '' && pair.clientSecret !== '';
      const halfFilled = !bothFilled && (pair.clientId !== '' || pair.clientSecret !== '');

      if (group.required && !bothFilled) {
        return {
          step: 'error',
          groupKey: group.key,
          message: `Escribe el Client ID y el Client Secret de ${group.label}.`,
        };
      }
      if (halfFilled) {
        return {
          step: 'error',
          groupKey: group.key,
          message: `Completa el Client ID y el Client Secret de ${group.label}, o deja ambos vacíos.`,
        };
      }
      if (bothFilled) credentials[group.key] = pair;
    }

    const result = await services.verifyBankCredentials({
      companyId,
      bank: bank.id,
      environment,
      credentials,
    });

    if (!result.ok) {
      return {
        step: 'error',
        groupKey: result.error.groupKey,
        message: bankFailureMessage(result.error.failure, bank.displayName),
      };
    }

    return {
      step: 'accounts',
      verifyId: result.value.verifyId,
      environment,
      accounts: result.value.accounts.map((a) => ({
        accountId: a.accountId,
        masked: a.masked,
        type: a.type,
        balanceCents: a.balanceCents,
      })),
    };
  } catch (error) {
    logger.error('verify_bank_core_unexpected', {
      companyId,
      err: error instanceof Error ? error.message : String(error),
    });
    return {
      step: 'error',
      groupKey: 'confirmation',
      message: 'Algo falló al verificar con el banco. Intenta de nuevo.',
    };
  }
}

/** Step 3: connect the chosen (or typed) account. The caller revalidates. */
export async function connectBankCore(companyId: string, form: FormData): Promise<ConnectState> {
  const verifyId = textField(form, 'verifyId');
  const accountId = textField(form, 'accountId');
  const accountNumber = textField(form, 'accountNumber');
  if (verifyId === '') {
    return { step: 'error', message: 'La verificación expiró. Vuelve a empezar el alta.' };
  }
  if (accountId === '' && accountNumber === '') {
    return { step: 'error', message: 'Elige o escribe la cuenta que recibe los pagos.' };
  }

  // Same rule as verify: an unforeseen throw becomes a toast, never a 500.
  try {
    const result = await container().banking.connectBankAccount({
      companyId,
      verifyId,
      accountId: accountId === '' ? undefined : accountId,
      accountNumber: accountNumber === '' ? undefined : accountNumber,
    });
    if (!result.ok) return { step: 'error', message: bankFailureMessage(result.error) };

    return { step: 'done' };
  } catch (error) {
    logger.error('connect_bank_core_unexpected', {
      companyId,
      err: error instanceof Error ? error.message : String(error),
    });
    return { step: 'error', message: 'Algo falló al conectar la cuenta. Intenta de nuevo.' };
  }
}
