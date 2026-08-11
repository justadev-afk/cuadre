/**
 * Editing which accounts a connection receives transferencias in.
 *
 * The list is the merchant's, and it changes: an account is closed, a second one
 * is opened, a digit was typed wrong and the till has been answering *sin
 * resultados* ever since. So it is editable after the alta rather than fixed at
 * it — and edited whole, because that is what the merchant sees on screen.
 *
 * The bank is never called. It has nothing to say here: Banesco reports its
 * accounts masked and refuses a masked one back, which is exactly why these
 * numbers are typed. What guards the write instead is the bank's own rule
 * (`receivingAccountRule`), applied by `keepValidReceivingAccounts` — the same
 * function the field in the browser refuses with, so the screen and the store
 * cannot disagree about what a usable account looks like.
 */
import type { BankAccount } from '../../adapters/d1/bank-account.repository.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { BankGateway, BankId } from '../ports/bank-gateway.ts';
import { keepValidReceivingAccounts } from './receiving-accounts.ts';

type BankAccess = {
  get(bank: BankId): BankGateway;
};

type BankAccountStore = {
  listByCompany(companyId: string): Promise<readonly BankAccount[]>;
  setReceivingAccounts(
    id: string,
    accounts: readonly string[],
  ): Promise<Result<BankAccount, string>>;
};

export type SetReceivingAccountsDeps = {
  readonly banks: BankAccess;
  readonly accounts: BankAccountStore;
};

export type SetReceivingAccountsInput = {
  readonly companyId: string;
  readonly bankAccountId: string;
  /** As typed, in the merchant's order. Anything unusable is dropped here. */
  readonly accounts: readonly string[];
};

export type SetReceivingAccountsFailure = 'not_found' | 'write_failed';

export type SetReceivingAccounts = (
  input: SetReceivingAccountsInput,
) => Promise<Result<readonly string[], SetReceivingAccountsFailure>>;

export function makeSetReceivingAccounts({
  banks,
  accounts,
}: SetReceivingAccountsDeps): SetReceivingAccounts {
  return async (input) => {
    // Scoped by company before anything else: a connection id from another
    // merchant must read as "not found", never as a row to write.
    const owned = await accounts.listByCompany(input.companyId);
    const connection = owned.find((candidate) => candidate.id === input.bankAccountId) ?? null;
    if (connection === null) return err('not_found');

    const rule = banks.get(connection.bank).receivingAccountRule;
    const kept = keepValidReceivingAccounts(rule, input.accounts);

    const written = await accounts.setReceivingAccounts(connection.id, kept);
    if (!written.ok) return err('write_failed');

    return ok(written.value.receivingAccounts);
  };
}
