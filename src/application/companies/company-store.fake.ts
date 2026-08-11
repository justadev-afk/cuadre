/**
 * An in-memory `companies` table and an in-memory `bank_accounts` table for
 * the admin use cases, hand written so no test has to mock one of our own
 * modules.
 *
 * The two unique columns are enforced here because they are the whole reason
 * `create` returns a `Result` rather than a row: `companies.id` is the slug and
 * `companies.rif` is the tax id, and the use case has to be able to tell one
 * collision from the other. `update` accepts a patch with no `id` and no `rif`
 * in it, which is not a rule this fake enforces — it is a rule the type makes
 * unstateable, here and in D1 alike.
 *
 * The bank accounts carry a `secret` field that nothing in the real domain
 * types has. It stands in for the sealed columns, so a test can prove the
 * detail screen leaves them behind instead of trusting that it does.
 */
import { err, ok, type Result } from '../../shared/result.ts';
import type { Company, CompanyStatus } from './company.ts';
import type { ListedCompany } from './list-companies.ts';

type CompanyWriteFailure = 'slug_taken' | 'rif_taken' | 'not_found';

export type FakeCompanyRow = ListedCompany;

export type FakeCompanyStore = {
  readonly rows: FakeCompanyRow[];
  readonly queries: unknown[];
  /** Every patch that reached the UPDATE, so a test can assert what did not. */
  readonly patches: unknown[];
  create(input: {
    readonly id: string;
    readonly name: string;
    readonly rif: string;
    readonly industry: string | null;
    readonly createdAt: number;
  }): Promise<Result<Company, CompanyWriteFailure>>;
  findById(id: string): Promise<Company | null>;
  list(query: {
    readonly search?: string;
    readonly status?: CompanyStatus;
    readonly activeSince: number;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<{ readonly items: readonly ListedCompany[]; readonly total: number }>;
  update(
    id: string,
    patch: {
      readonly name?: string;
      readonly industry?: string | null;
      readonly status?: CompanyStatus;
    },
  ): Promise<Result<Company, CompanyWriteFailure>>;
};

export function makeFakeCompanyStore(
  seed: readonly Partial<FakeCompanyRow>[] = [],
): FakeCompanyStore {
  const rows: FakeCompanyRow[] = seed.map(companyRow);
  const queries: unknown[] = [];
  const patches: unknown[] = [];

  const find = (id: string) => rows.find((row) => row.id === id) ?? null;

  return {
    rows,
    queries,
    patches,

    async create(input) {
      if (rows.some((row) => row.id === input.id)) return err('slug_taken');
      if (rows.some((row) => row.rif === input.rif)) return err('rif_taken');
      const row = companyRow({ ...input, status: 'active' });
      rows.push(row);
      return ok(company(row));
    },

    async findById(id) {
      const row = find(id);
      return row === null ? null : company(row);
    },

    async list(query) {
      queries.push(query);
      const search = query.search?.trim().toLowerCase();
      const items = rows.filter(
        (row) =>
          (query.status === undefined || row.status === query.status) &&
          (search === undefined ||
            search === '' ||
            row.name.toLowerCase().includes(search) ||
            row.rif.toLowerCase().includes(search)),
      );
      return { items, total: items.length };
    },

    async update(id, patch) {
      patches.push(patch);
      const row = find(id);
      if (row === null) return err('not_found');
      const updated: FakeCompanyRow = { ...row, ...patch };
      rows.splice(rows.indexOf(row), 1, updated);
      return ok(company(updated));
    },
  };
}

/** Stands in for a sealed column: present on the row, never on the screen. */
export type FakeBankAccountRow = {
  readonly id: string;
  readonly companyId: string;
  readonly bank: string;
  readonly environment: 'production' | 'sandbox';
  readonly status: 'active' | 'needs_reverify' | 'removed';
  readonly label: string | null;
  readonly clientIdLast6: string | null;
  readonly receivingAccounts: readonly string[];
  readonly verifiedAt: number | null;
  readonly credsExpireAt: number | null;
  readonly createdAt: number;
  readonly secret: string;
};

export function makeFakeBankAccounts(seed: readonly Partial<FakeBankAccountRow>[] = []) {
  const rows = seed.map(bankAccountRow);
  const asked: string[] = [];
  return {
    rows,
    asked,
    async listByCompany(companyId: string): Promise<readonly FakeBankAccountRow[]> {
      asked.push(companyId);
      return rows.filter((row) => row.companyId === companyId);
    },
  };
}

function companyRow(overrides: Partial<FakeCompanyRow>): FakeCompanyRow {
  return {
    id: 'la-espiga',
    name: 'Panadería La Espiga',
    rif: 'J-07013380-5',
    industry: 'panaderia',
    status: 'active',
    createdAt: 1_760_000_000,
    cashierCount: 0,
    recentValidationCount: 0,
    ...overrides,
  };
}

/**
 * The counts belong to the admin table's two subqueries and to nothing else,
 * so only `list` answers with them — exactly as the SELECTs in D1 do.
 */
function company(row: FakeCompanyRow): Company {
  const { cashierCount: _cashiers, recentValidationCount: _validations, ...rest } = row;
  return rest;
}

function bankAccountRow(overrides: Partial<FakeBankAccountRow>): FakeBankAccountRow {
  return {
    id: 'account-1',
    companyId: 'la-espiga',
    bank: 'banesco',
    environment: 'production',
    status: 'active',
    label: 'Caja principal',
    clientIdLast6: 'a91c2f',
    receivingAccounts: [],
    verifiedAt: 1_760_000_500,
    credsExpireAt: null,
    createdAt: 1_760_000_000,
    secret: 'sealed-client-secret',
    ...overrides,
  };
}
