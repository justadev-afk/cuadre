/**
 * Which accounts a connection can receive a transferencia in — the dropdown the
 * counter fills the moment a cashier picks a receiving bank.
 *
 * One source, and that is the whole design: **the merchant's own numbers**. A
 * transferencia is found by the full 20-digit account, and only the merchant can
 * supply it. Banesco's Consulta de Saldo looks like it should — it lists the
 * affiliation's accounts — but it reports them masked (`0134************5306`)
 * and the payment search answers 400 to a masked `accountId`, as reported and
 * with the asterisks stripped alike (probed against QA, 2026-08-11). So that
 * service is not asked for at all, and there is nothing here to decorate the
 * list with: what the merchant registered is what the cashier picks from.
 *
 * A connection with no account registered simply cannot validate transferencias,
 * and the till says exactly that. It is a fact about the merchant's setup, not
 * about the bank being unreachable — which is why this never calls one.
 */
import type { BankAccount } from '../../adapters/d1/bank-account.repository.ts';

/** How the counter's dropdown shows one account. */
export type ReceivingAccount = {
  /** The full number — what the payment search is asked with. */
  readonly number: string;
  /** '···· 5394' — all of it a screen at a counter ever shows. */
  readonly masked: string;
};

type BankAccountReader = {
  listActiveForCompany(companyId: string): Promise<readonly BankAccount[]>;
};

export type ListReceivingAccountsDeps = {
  readonly accounts: BankAccountReader;
};

export type ListReceivingAccountsInput = {
  readonly companyId: string;
  readonly bankAccountId: string;
};

export type ListReceivingAccounts = (
  input: ListReceivingAccountsInput,
) => Promise<readonly ReceivingAccount[]>;

export function makeListReceivingAccounts({
  accounts,
}: ListReceivingAccountsDeps): ListReceivingAccounts {
  return async (input) => {
    // Scoped by company first, so a tampered connection id finds nothing rather
    // than another merchant's accounts.
    const usable = await accounts.listActiveForCompany(input.companyId);
    const connection = usable.find((candidate) => candidate.id === input.bankAccountId) ?? null;
    if (connection === null) return [];

    return connection.receivingAccounts.map((number) => ({
      number,
      masked: `···· ${lastFour(number)}`,
    }));
  };
}

function lastFour(value: string): string {
  return value.replace(/\D/g, '').slice(-4);
}
