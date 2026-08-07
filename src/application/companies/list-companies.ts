/**
 * The platform admin's company table.
 *
 * The two counts ride along with each row because the table shows them on
 * every row: asking per company would be one query per merchant on a screen
 * whose whole purpose is to be scanned. What "recent" means is decided *here*
 * and not in the repository — this is the layer holding the `Clock`, and a
 * repository that read the time would be as untestable as a domain rule that
 * did.
 *
 * This is the one list in `src/application` with no `company_id` in it, and
 * deliberately so: the platform team is the single population entitled to see
 * every merchant. Nothing in this file decides who that is. The guard that
 * keeps a company user out lives on the route, next to the session.
 */
import type { Clock } from '../../shared/clock.ts';
import type { Company, CompanyStatus } from './company.ts';

/** One row of the admin table: the company, plus how alive it is. */
export type ListedCompany = Company & {
  /** Cashiers who can still sign in. A disabled one is not a seat in use. */
  readonly cashierCount: number;
  /** Real validations — never sandbox — since `RECENT_ACTIVITY_DAYS` ago. */
  readonly recentValidationCount: number;
};

export type ListedCompanyPage = {
  readonly items: readonly ListedCompany[];
  /** Matching rows, ignoring the page window. Drives the pager. */
  readonly total: number;
};

/**
 * The narrow port this use case consumes. `activeSince` is an epoch second
 * rather than a number of days: the repository is handed a boundary, never a
 * policy, so "the last thirty days" is a product decision with one home.
 */
export interface CompanyDirectory {
  list(query: {
    readonly search?: string;
    readonly status?: CompanyStatus;
    readonly activeSince: number;
    readonly limit?: number;
    readonly offset?: number;
  }): Promise<ListedCompanyPage>;
}

/**
 * How far back the "activa" column looks. Long enough to survive a merchant's
 * slow week, short enough that a company which stopped three months ago does
 * not still read as busy.
 */
export const RECENT_ACTIVITY_DAYS = 30;

const DAY_SECONDS = 24 * 60 * 60;

export type ListCompaniesInput = {
  /** Matched against the name and the RIF by the repository. */
  readonly search?: string;
  readonly status?: CompanyStatus;
  readonly limit?: number;
  readonly offset?: number;
};

export type ListCompanies = (input: ListCompaniesInput) => Promise<ListedCompanyPage>;

export type ListCompaniesDeps = {
  readonly companies: CompanyDirectory;
  readonly clock: Clock;
};

export function makeListCompanies({ companies, clock }: ListCompaniesDeps): ListCompanies {
  return (input) =>
    companies.list({
      ...input,
      activeSince: clock.nowSeconds() - RECENT_ACTIVITY_DAYS * DAY_SECONDS,
    });
}
