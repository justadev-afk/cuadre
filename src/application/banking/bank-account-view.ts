/**
 * A connected bank as a screen may hold it.
 *
 * `BankAccount` carries a `Sealed` envelope per credential pair, and a use case
 * that returned one would be handing ciphertext to a React component —
 * serialised across the RSC boundary, sitting in a payload, one
 * `JSON.stringify` away from a log. Nothing downstream can use those bytes: the
 * key never leaves the server. So the projection drops them here, once, and
 * every banking use case answers with this shape.
 *
 * What is left is exactly what the "bancos conectados" card and the counter's
 * "banco receptor" dropdown show: which bank, which environment, what the
 * merchant calls it, and when it was last verified.
 */
import type { BankAccount, BankAccountStatus } from '../../adapters/d1/bank-account.repository.ts';
import type { BankEnvironment, BankId } from '../ports/bank-gateway.ts';

export type BankAccountView = {
  readonly id: string;
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  /** The merchant's own name for this connection, when they gave one. */
  readonly label: string | null;
  /** The accounts this connection receives transferencias in. Empty = pago móvil only. */
  readonly receivingAccounts: readonly string[];
  /** All the UI ever shows of the OAuth client. */
  readonly clientIdLast6: string | null;
  readonly status: BankAccountStatus;
  readonly verifiedAt: number | null;
  /** The seven-day warning the panel renders. Null when the bank never said. */
  readonly credsExpireAt: number | null;
  readonly createdAt: number;
};

export function toBankAccountView(account: BankAccount): BankAccountView {
  return {
    id: account.id,
    bank: account.bank,
    environment: account.environment,
    label: account.label,
    receivingAccounts: account.receivingAccounts,
    clientIdLast6: account.clientIdLast6,
    status: account.status,
    verifiedAt: account.verifiedAt,
    credsExpireAt: account.credsExpireAt,
    createdAt: account.createdAt,
  };
}
