/**
 * One company and the banks it has connected — the admin's "bancos de una
 * empresa" screen.
 *
 * **Nothing here decrypts anything.** The repository hands back each connection
 * with its AES-GCM envelope attached, and this file copies out the fields the
 * screen renders and leaves the rest behind. That is a deliberate map rather
 * than a lazy pass-through: a use case that returned the row as it arrived would
 * put the sealed client secret one `JSON.stringify` away from a response body.
 * `CREDS_KEY` is not a dependency of this use case and must not become one — the
 * only reason to unseal a client secret is to call the bank, and that lives in
 * the banking use cases.
 *
 * The read is scoped by construction: the caller names one company and gets
 * that company's accounts, because `companyId` is the only key either query
 * has. There is no shape of input here that reaches across two merchants.
 */
import { err, ok, type Result } from '../../shared/result.ts';
import type { Company } from './company.ts';

export type BankAccountStatus = 'active' | 'needs_reverify' | 'removed';

/**
 * What the screen shows about an affiliation, and the whole of it. The last 6
 * of the client id is the clear-text remains of the sealed credentials;
 * everything else here is metadata.
 */
export type CompanyBankAccount = {
  readonly id: string;
  /** The registry key of the gateway that speaks to it, e.g. 'banesco'. */
  readonly bank: string;
  readonly environment: 'production' | 'sandbox';
  readonly status: BankAccountStatus;
  /** The merchant's own name for the connection, when they gave one. */
  readonly label: string | null;
  readonly clientIdLast6: string | null;
  readonly verifiedAt: number | null;
  /** QA credentials expire; the panel warns seven days out. */
  readonly credsExpireAt: number | null;
  readonly createdAt: number;
};

export type CompanyDetail = {
  readonly company: Company;
  readonly bankAccounts: readonly CompanyBankAccount[];
};

/**
 * The narrow ports. `listByCompany` is declared with one parameter although
 * the repository takes an optional second: a removed affiliation is history
 * that `validations.bank_account_id` still points at, not a row this screen
 * has any use for.
 */
export interface CompanyReader {
  findById(id: string): Promise<Company | null>;
}

export interface CompanyBankAccounts {
  listByCompany(companyId: string): Promise<readonly CompanyBankAccount[]>;
}

export type GetCompanyInput = { readonly companyId: string };

export type GetCompany = (input: GetCompanyInput) => Promise<Result<CompanyDetail, 'not_found'>>;

export type GetCompanyDeps = {
  readonly companies: CompanyReader;
  readonly bankAccounts: CompanyBankAccounts;
};

export function makeGetCompany({ companies, bankAccounts }: GetCompanyDeps): GetCompany {
  return async ({ companyId }) => {
    // Both reads go at once. A company that does not exist costs one wasted
    // query against an index that returns nothing, which is cheaper than
    // putting a second round trip in front of every screen that does.
    const [company, accounts] = await Promise.all([
      companies.findById(companyId),
      bankAccounts.listByCompany(companyId),
    ]);

    if (company === null) return err('not_found');

    return ok({ company, bankAccounts: accounts.map(toSummary) });
  };
}

/** Field by field, so nothing sealed can ride along on a spread. */
function toSummary(account: CompanyBankAccount): CompanyBankAccount {
  return {
    id: account.id,
    bank: account.bank,
    environment: account.environment,
    status: account.status,
    label: account.label,
    clientIdLast6: account.clientIdLast6,
    verifiedAt: account.verifiedAt,
    credsExpireAt: account.credsExpireAt,
    createdAt: account.createdAt,
  };
}
