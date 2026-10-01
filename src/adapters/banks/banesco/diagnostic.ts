/**
 * The one line a merchant reads out to Banesco's desk when a call fails:
 * `banesco prd · token · HTTP 401 · invalid_grant`.
 *
 * Which environment, which of the two calls, what came back — the three facts
 * that settle "is it the credentials, the realm or the bank". Only codes ever
 * go in: never a body, a token, a reference or an account (§8).
 */
import type { BankEnvironment } from '../../../application/ports/bank-gateway.ts';

export type BanescoStep = 'token' | 'consulta';

export function diagnose(
  environment: BankEnvironment,
  step: BanescoStep,
  ...facts: readonly (string | null | undefined)[]
): string {
  const env = environment === 'production' ? 'prd' : 'qa';
  return [`banesco ${env}`, step, ...facts].filter((part) => part).join(' · ');
}
