/**
 * What the platform team may change about a company after it exists: its
 * name, its industry, and whether it is suspended.
 *
 * **Not the slug, and not the RIF.** The slug is `companies.id` — it is in
 * `users.company_id`, `bank_accounts.company_id` and `validations.company_id`,
 * so changing it would rewrite the ownership of every payment the merchant has
 * ever confirmed. The RIF is the tax identity a bank account is verified
 * against and it carries a UNIQUE constraint; a company whose RIF changes is a
 * different legal person, not the same row with a new value.
 *
 * Neither is enforced with a check. `CompanyChanges` has no field for either
 * one and neither does the repository's patch, so there is no statement in
 * this codebase that can move them after the INSERT. A rule that cannot be
 * expressed is a rule that cannot be forgotten in a review.
 */
import { err, ok, type Result } from '../../shared/result.ts';
import type { Company, CompanyStatus } from './company.ts';

/**
 * Exactly the three columns that may move. Every field is optional and
 * `undefined` means "leave it": the admin form posts the whole company, and a
 * patch that could not tell "unchanged" from "cleared" would blank an industry
 * every time somebody renamed a bakery.
 */
export type CompanyChanges = {
  readonly name?: string;
  /** `null` clears it. */
  readonly industry?: string | null;
  readonly status?: CompanyStatus;
};

/** The narrow port. `not_found` is the only thing an UPDATE by id can miss. */
export interface CompanyWriter {
  update(
    id: string,
    patch: CompanyChanges,
  ): Promise<Result<Company, 'slug_taken' | 'rif_taken' | 'not_found'>>;
}

export type UpdateCompanyInput = CompanyChanges & {
  /** The slug of the company being edited. It is a key here, never a value. */
  readonly companyId: string;
};

export type UpdateCompany = (input: UpdateCompanyInput) => Promise<Result<Company, 'not_found'>>;

export type UpdateCompanyDeps = { readonly companies: CompanyWriter };

export function makeUpdateCompany({ companies }: UpdateCompanyDeps): UpdateCompany {
  return async ({ companyId, ...changes }) => {
    const patch: { name?: string; industry?: string | null; status?: CompanyStatus } = {};

    // Built key by key rather than by spreading the input, so a field the
    // caller did not send never reaches the SET clause as `undefined` — and so
    // that a field this use case does not offer cannot arrive as an extra
    // property and be passed straight through to the repository.
    if (changes.name !== undefined) patch.name = changes.name.trim();
    if (changes.industry !== undefined) patch.industry = blankToNull(changes.industry);
    if (changes.status !== undefined) patch.status = changes.status;

    const updated = await companies.update(companyId, patch);
    // `slug_taken` and `rif_taken` belong to the INSERT: neither column is in
    // the patch, so an UPDATE built from it cannot collide on either.
    return updated.ok ? ok(updated.value) : err('not_found');
  };
}

/** An industry cleared on the form arrives as spaces, and means no industry. */
function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}
