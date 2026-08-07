/**
 * A connected account as a screen may hold it.
 *
 * `BankAccount` carries two `Sealed` envelopes, and a use case that returned
 * one would be handing ciphertext to a React component — serialised across the
 * RSC boundary, sitting in a payload, one `JSON.stringify` away from a log.
 * Nothing downstream can use those bytes: the key never leaves the server. So
 * the projection drops them here, once, and every banking use case answers with
 * this shape.
 *
 * What is left is exactly what the design shows on the "bancos conectados"
 * card: which bank, which environment, the last four of the account, and when
 * it was last verified.
 */
import type { BankAccount, BankAccountStatus } from '../../adapters/d1/bank-account.repository.ts';
import type { BankEnvironment, BankId } from '../ports/bank-gateway.ts';

export type BankAccountView = {
  readonly id: string;
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  /** All the UI ever shows of the OAuth client. */
  readonly clientIdLast6: string | null;
  readonly accountLast4: string;
  readonly accountType: string | null;
  readonly holderId: string | null;
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
    clientIdLast6: account.clientIdLast6,
    accountLast4: account.accountLast4,
    accountType: account.accountType,
    holderId: account.holderId,
    status: account.status,
    verifiedAt: account.verifiedAt,
    credsExpireAt: account.credsExpireAt,
    createdAt: account.createdAt,
  };
}
