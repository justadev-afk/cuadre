/**
 * Which accounts a connection can receive a transferencia in — the dropdown the
 * counter fills the moment a cashier picks a receiving bank.
 *
 * Two sources, and the split between them is the whole design:
 *
 *  - **The merchant's stored numbers are the truth.** A transferencia is found
 *    by the full 20-digit account, and only the merchant can supply it: Banesco
 *    reports its accounts masked (`0134************5306`) and refuses a masked
 *    one back with a 400. So the list is what they registered, and a connection
 *    with none simply cannot validate transferencias.
 *  - **The bank's own list is decoration.** Asked through the discover
 *    credential and cached for a day, it supplies the type and the balance
 *    beside each number so the dropdown reads like the merchant's bank app
 *    rather than like twenty digits. It is matched by the last four, never used
 *    as a handle, and its absence costs nothing but the adornment.
 *
 * A bank that cannot be asked at all still yields the stored accounts. The one
 * thing that turns transferencias off for a connection is having no account
 * registered — which is a fact about the merchant, not about the bank's mood.
 */
import type { BankAccount } from '../../adapters/d1/bank-account.repository.ts';
import { unseal } from '../../shared/crypto.ts';
import { logger } from '../../shared/logger.ts';
import type { BankAccountSummary, BankGateway, BankId } from '../ports/bank-gateway.ts';
import { type AccountCredentials, discoverCredential } from './account-credentials.ts';

/** How the counter's dropdown shows one account. */
export type ReceivingAccount = {
  /** The full number — what the payment search is asked with. */
  readonly number: string;
  /** '···· 5394', or the bank's own masking when it offered one. */
  readonly masked: string;
  /** 'DDA', 'Corriente' — whatever the bank calls it. Null when unknown. */
  readonly type: string | null;
  readonly balanceCents: number | null;
};

type BankAccess = {
  get(bank: BankId): BankGateway;
};

type BankAccountReader = {
  listActiveForCompany(companyId: string): Promise<readonly BankAccount[]>;
};

type ListingCache = {
  get(bankAccountId: string): Promise<readonly BankAccountSummary[] | null>;
  put(bankAccountId: string, accounts: readonly BankAccountSummary[]): Promise<void>;
};

export type ListReceivingAccountsDeps = {
  readonly banks: BankAccess;
  readonly accounts: BankAccountReader;
  readonly listings: ListingCache;
  readonly credsKey: string;
};

export type ListReceivingAccountsInput = {
  readonly companyId: string;
  readonly bankAccountId: string;
};

export type ListReceivingAccounts = (
  input: ListReceivingAccountsInput,
) => Promise<readonly ReceivingAccount[]>;

export function makeListReceivingAccounts({
  banks,
  accounts,
  listings,
  credsKey,
}: ListReceivingAccountsDeps): ListReceivingAccounts {
  return async (input) => {
    // Scoped by company first, so a tampered connection id finds nothing rather
    // than another merchant's accounts.
    const usable = await accounts.listActiveForCompany(input.companyId);
    const connection = usable.find((candidate) => candidate.id === input.bankAccountId) ?? null;
    if (connection === null || connection.receivingAccounts.length === 0) return [];

    const listed = await describe({ banks, listings, credsKey }, connection);

    return connection.receivingAccounts.map((number) => {
      const match = listed.find((account) => lastFour(account.masked) === lastFour(number));
      return {
        number,
        masked: match?.masked ?? `···· ${lastFour(number)}`,
        type: match?.type ?? null,
        balanceCents: match?.balanceCents ?? null,
      };
    });
  };
}

/**
 * The bank's list, from the cache or from the bank. Never a reason to fail: the
 * caller has the accounts already and this only dresses them.
 */
async function describe(
  deps: Pick<ListReceivingAccountsDeps, 'banks' | 'listings' | 'credsKey'>,
  connection: BankAccount,
): Promise<readonly BankAccountSummary[]> {
  const cached = await deps.listings.get(connection.id);
  if (cached !== null) return cached;

  const gateway = deps.banks.get(connection.bank);
  let opened: AccountCredentials;
  try {
    opened = await unseal<AccountCredentials>(deps.credsKey, connection.credentials);
  } catch {
    logger.warn('bank_listing_unsealable', { bankAccountId: connection.id });
    return [];
  }

  // The discover pair — or the only pair there is, which is the production shape
  // where one client does both jobs.
  const credentials = discoverCredential(opened, gateway.discoverKey, gateway.operateKey);
  if (credentials === null) return [];

  const session = await gateway.authenticate(connection.environment, credentials);
  if (!session.ok) {
    // Very likely the single-credential case on a bank that splits its services:
    // the pair that validates payments cannot list accounts. Not an error the
    // merchant can act on, and not a reason to hide their own accounts.
    logger.info('bank_listing_unavailable', {
      bank: connection.bank,
      bankAccountId: connection.id,
      failure: session.error,
    });
    return [];
  }

  const listed = await gateway.listAccounts(session.value);
  if (!listed.ok) {
    logger.info('bank_listing_failed', {
      bank: connection.bank,
      bankAccountId: connection.id,
      failure: listed.error,
    });
    return [];
  }

  // Only a real answer is cached — a bad minute at the bank must not switch the
  // adornment off for a day.
  await deps.listings.put(connection.id, listed.value);
  return listed.value;
}

function lastFour(value: string): string {
  return value.replace(/\D/g, '').slice(-4);
}
