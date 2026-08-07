'use server';

/**
 * The bank-onboarding actions: verify, then connect. Two steps because nothing
 * is persisted until the merchant has picked which account receives the
 * payments — both credential pairs wait in KV under the `verifyId` for ten
 * minutes and no `bank_accounts` row exists until `connect` succeeds.
 *
 * A bank may ask for more than one credential pair (Banesco: a required
 * Confirmación pair the counter runs on, and an optional Consulta pair that
 * lists the accounts). This action reads them by group, validates each one
 * individually in the use case, and reports which pair a refusal belongs to.
 */
import { revalidatePath } from 'next/cache';

import type { AccountCredentials } from '../../../application/banking/account-credentials.ts';
import type { BankCredentials } from '../../../application/ports/bank-gateway.ts';
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { secretField, textField } from '../../_lib/inputs.ts';
import type { ConnectState, VerifyState } from './form-state.ts';

const ONBOARDING_MESSAGES: Record<string, string> = {
  rejected_credentials:
    'Banesco rechazó estas credenciales. Revisa el Client ID y el Client Secret.',
  environment_mismatch: 'Estas credenciales no son del entorno que declaraste.',
  no_accounts:
    'Las credenciales son válidas, pero Banesco no reporta cuentas para esta afiliación.',
  maintenance: 'Banesco está en mantenimiento. Intenta de nuevo en un rato.',
  unavailable: 'Banesco no pudo responder. Intenta de nuevo.',
  timeout: 'Banesco tardó demasiado. Intenta de nuevo.',
  invalid_input: 'Revisa los datos e intenta de nuevo.',
};

/** Reads one credential pair from the form, by the group prefix the wizard uses. */
function readPair(form: FormData, prefix: string): BankCredentials {
  return {
    clientId: textField(form, `${prefix}.clientId`),
    clientSecret: secretField(form, `${prefix}.clientSecret`),
  };
}

export async function verifyBankAction(
  _previous: VerifyState,
  form: FormData,
): Promise<VerifyState> {
  const { companyId } = await requireCompany();
  const services = container().banking;

  const environment = textField(form, 'environment') === 'sandbox' ? 'sandbox' : 'production';

  // The bank's own declaration is the list of pairs to read — nothing here names
  // a service. A required group left blank, or half a group, is reported on that
  // group so the message lands under the right fields.
  const bank = services.listSupportedBanks().find((b) => b.id === 'banesco');
  if (bank === undefined) {
    return { step: 'error', groupKey: 'bank', message: 'Ese banco no está disponible.' };
  }

  const credentials: AccountCredentials = {};
  for (const group of bank.credentialGroups) {
    const pair = readPair(form, group.key);
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
    bank: 'banesco',
    environment,
    credentials,
  });

  if (!result.ok) {
    return {
      step: 'error',
      groupKey: result.error.groupKey,
      message: ONBOARDING_MESSAGES[result.error.failure] ?? 'No se pudo verificar.',
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
}

const CONNECT_MESSAGES: Record<string, string> = {
  ...ONBOARDING_MESSAGES,
  verification_expired: 'La verificación expiró. Vuelve a empezar el alta.',
  unknown_account: 'Esa cuenta ya no está en la lista. Vuelve a verificar.',
  invalid_account: 'Ese número de cuenta no es válido. Revísalo e intenta de nuevo.',
  account_already_linked: 'Esa cuenta ya está conectada.',
};

export async function connectBankAction(
  _previous: ConnectState,
  form: FormData,
): Promise<ConnectState> {
  const { companyId } = await requireCompany();

  const verifyId = textField(form, 'verifyId');
  const accountId = textField(form, 'accountId');
  const accountNumber = textField(form, 'accountNumber');
  if (verifyId === '') {
    return { step: 'error', message: 'La verificación expiró. Vuelve a empezar el alta.' };
  }
  if (accountId === '' && accountNumber === '') {
    return { step: 'error', message: 'Elige o escribe la cuenta que recibe los pagos.' };
  }

  const result = await container().banking.connectBankAccount({
    companyId,
    verifyId,
    accountId: accountId === '' ? undefined : accountId,
    accountNumber: accountNumber === '' ? undefined : accountNumber,
  });
  if (!result.ok) {
    return {
      step: 'error',
      message: CONNECT_MESSAGES[result.error] ?? 'No se pudo conectar la cuenta.',
    };
  }

  revalidatePath('/banks');
  return { step: 'done' };
}
