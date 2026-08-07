/**
 * Disconnecting a bank. It sets a status; it never deletes.
 *
 * `validations.bank_account_id` points at this row and that history has to keep
 * resolving years after a merchant changes banks — so "removed" is a state the
 * account is in, not a row that is gone. The sealed credentials stay sealed and
 * stop being read: `findActiveForCompany` already refuses a removed account, so
 * the counter stops using it the moment this returns.
 */
import type {
  BankAccount,
  BankAccountWriteFailure,
} from '../../adapters/d1/bank-account.repository.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { type BankAccountView, toBankAccountView } from './bank-account-view.ts';

type BankAccountStore = {
  findById(id: string): Promise<BankAccount | null>;
  remove(id: string): Promise<Result<BankAccount, BankAccountWriteFailure>>;
};

export type RemoveBankAccountDeps = {
  readonly accounts: BankAccountStore;
};

export type RemoveBankAccountInput = {
  readonly companyId: string;
  readonly accountId: string;
};

export type RemoveBankAccountFailure = 'not_found';

export type RemoveBankAccount = (
  input: RemoveBankAccountInput,
) => Promise<Result<BankAccountView, RemoveBankAccountFailure>>;

export function makeRemoveBankAccount({ accounts }: RemoveBankAccountDeps): RemoveBankAccount {
  return async (input) => {
    const account = await accounts.findById(input.accountId);

    // `findById` is keyed by the primary key alone, so the company check is
    // here — and it answers `not_found` rather than `forbidden`, because
    // "there is no such account" and "that account is not yours" must be
    // indistinguishable from outside. Otherwise this endpoint enumerates other
    // merchants' account ids.
    if (account === null || account.companyId !== input.companyId) return err('not_found');

    const removed = await accounts.remove(account.id);
    if (!removed.ok) return err('not_found');

    logger.info('bank_account_removed', {
      companyId: input.companyId,
      bank: account.bank,
      environment: account.environment,
    });

    return ok(toBankAccountView(removed.value));
  };
}
