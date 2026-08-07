/**
 * The banks a company has connected, for the "bancos" panel.
 *
 * Removed accounts are excluded by default and available on request, because
 * `remove` is a status change and the rows never go anywhere — a merchant
 * looking for the account a validation from March points at has to be able to
 * find it.
 */
import type { BankAccount } from '../../adapters/d1/bank-account.repository.ts';
import { type BankAccountView, toBankAccountView } from './bank-account-view.ts';

type BankAccountReader = {
  listByCompany(companyId: string, includeRemoved?: boolean): Promise<readonly BankAccount[]>;
};

export type ListBankAccountsDeps = {
  readonly accounts: BankAccountReader;
};

export type ListBankAccountsInput = {
  readonly companyId: string;
  readonly includeRemoved?: boolean;
};

export type ListBankAccounts = (
  input: ListBankAccountsInput,
) => Promise<readonly BankAccountView[]>;

export function makeListBankAccounts({ accounts }: ListBankAccountsDeps): ListBankAccounts {
  return async (input) => {
    const rows = await accounts.listByCompany(input.companyId, input.includeRemoved ?? false);
    return rows.map(toBankAccountView);
  };
}
