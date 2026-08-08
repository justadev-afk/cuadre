/**
 * A bank's refusal, in the words the merchant reads. One table for every
 * onboarding screen — connecting an account and changing its credentials fail
 * for the same reasons, and two tables meant the same refusal read differently
 * depending on which modal was open.
 *
 * The bank is a **parameter**, never a literal: the copy used to say "Banesco"
 * inside bank-agnostic code, which is precisely the leak §4 forbids. A caller
 * that knows which bank it asked passes the display name; one that does not
 * (a refusal before the bank is resolved) gets "El banco".
 */

/** Every failure the onboarding use cases answer with, plus connect's own. */
const MESSAGES: Record<string, (bank: string) => string> = {
  rejected_credentials: (bank) =>
    `${bank} rechazó estas credenciales. Revisa el Client ID y el Client Secret.`,
  environment_mismatch: () => 'Estas credenciales no son de ese entorno.',
  no_accounts: () =>
    'Las credenciales son válidas, pero no hay cuentas reportadas para esta afiliación.',
  maintenance: (bank) => `${bank} está en mantenimiento. Intenta de nuevo en un rato.`,
  unavailable: (bank) => `${bank} no pudo responder. Intenta de nuevo.`,
  timeout: (bank) => `${bank} tardó demasiado. Intenta de nuevo.`,
  invalid_input: () => 'Escribe el Client ID y el Client Secret.',
  not_found: () => 'No encontramos esa cuenta.',

  // Only the last step of the alta can reach these: the verification is parked
  // in KV for ten minutes and the account is chosen out of what it holds.
  verification_expired: () => 'La verificación expiró. Vuelve a empezar el alta.',
  unknown_account: () => 'Esa cuenta ya no está en la lista. Vuelve a verificar.',
  invalid_account: () => 'Ese número de cuenta no es válido. Revísalo e intenta de nuevo.',
  account_already_linked: () => 'Esa cuenta ya está conectada.',
};

/** The default subject: a refusal that arrived before we knew which bank. */
const UNKNOWN_BANK = 'El banco';

export function bankFailureMessage(failure: string, bankName: string = UNKNOWN_BANK): string {
  return MESSAGES[failure]?.(bankName) ?? 'No se pudo completar la operación. Intenta de nuevo.';
}
