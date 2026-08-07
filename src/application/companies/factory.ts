/**
 * The admin area's company use cases, built over adapters that already exist.
 *
 * Nothing is constructed here — no `env`, no `D1Database`, no bank. That is
 * `src/container.ts`'s job, and keeping it there is what lets this file be
 * called with four hand-written fakes in a test.
 *
 * `CompanyUseCaseDeps` is the intersection of what each use case declared for
 * itself rather than a fifth list written by hand. A port that gains a method
 * therefore widens this type automatically, and the compiler reports the gap
 * against the container that has to supply it — not against a list here that
 * somebody forgot to update.
 */
import { type CreateCompany, type CreateCompanyDeps, makeCreateCompany } from './create-company.ts';
import { type GetCompany, type GetCompanyDeps, makeGetCompany } from './get-company.ts';
import { type ListCompanies, type ListCompaniesDeps, makeListCompanies } from './list-companies.ts';
import { makeUpdateCompany, type UpdateCompany, type UpdateCompanyDeps } from './update-company.ts';

export type CompanyUseCaseDeps = ListCompaniesDeps &
  CreateCompanyDeps &
  UpdateCompanyDeps &
  GetCompanyDeps;

export type CompanyUseCases = {
  readonly listCompanies: ListCompanies;
  readonly createCompany: CreateCompany;
  readonly updateCompany: UpdateCompany;
  readonly getCompany: GetCompany;
};

export function makeCompanyUseCases(deps: CompanyUseCaseDeps): CompanyUseCases {
  return {
    listCompanies: makeListCompanies(deps),
    createCompany: makeCreateCompany(deps),
    updateCompany: makeUpdateCompany(deps),
    getCompany: makeGetCompany(deps),
  };
}
