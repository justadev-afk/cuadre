/**
 * Registers a merchant and the person who will administer it, in one flow.
 *
 * The two writes cannot be one. The administrator is a row in `users` whose
 * `company_id` is a foreign key onto the company, so the company has to exist
 * first, and D1 gives us no transaction spanning two repositories. What that
 * leaves is an order chosen to make the common failure clean: the email is
 * checked *before* anything is written, so an address that is already
 * registered — by some distance the most likely refusal here — comes back with
 * nothing created. Only a true race can still land between the check and the
 * insert, and when it does the company row exists without an administrator.
 * That is logged at error level because it needs a human: the slug and the RIF
 * it holds are both UNIQUE and neither can be handed to a second attempt.
 *
 * The slug becomes `companies.id` — the primary key, the string a cashier
 * types at the counter, and the value carried by every foreign key in the
 * schema. **It is chosen exactly once, here, and can never be changed.**
 * `update-company.ts` has no field for it and neither does the repository's
 * patch type, so there is no statement in this codebase that can move it. A
 * merchant who needs a different slug is a new company.
 */
import { isValidRif, normaliseRif, normaliseSlug } from '../../domain/company.ts';
import { isValidPassword } from '../../domain/credentials.ts';
import type { Clock } from '../../shared/clock.ts';
import { hashPassword } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
import type { IdGen } from '../../shared/id.ts';
import { logger } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import type { Company } from './company.ts';

export type CompanyAdmin = {
  readonly id: string;
  readonly name: string;
  readonly email: string;
};

export type CreatedCompany = {
  readonly company: Company;
  readonly admin: CompanyAdmin;
};

/**
 * The repository's whole write vocabulary, declared in full because the port
 * has to accept everything the adapter can return. Most of it cannot happen on
 * this path — which is exactly why the ones that cannot are worth an
 * `AppError` if they ever do.
 */
type UserWriteFailure =
  | 'email_taken'
  | 'username_taken'
  | 'invalid_for_role'
  | 'unknown_company'
  | 'not_found'
  | 'has_history';

/** The narrow ports. Two collaborators, because this flow writes two rows. */
export interface CompanyRegistry {
  create(input: {
    readonly id: string;
    readonly name: string;
    readonly rif: string;
    readonly industry: string | null;
    readonly createdAt: number;
  }): Promise<Result<Company, 'slug_taken' | 'rif_taken' | 'not_found'>>;
}

export interface CompanyAdminRegistry {
  /** Carries the password hash, which is why nothing here renders the result. */
  findByEmail(email: string): Promise<{ readonly id: string } | null>;
  createUser(input: {
    readonly id: string;
    readonly companyId: string;
    /** Only ever `'company'` here. See the note on the role, below. */
    readonly role: 'company';
    readonly name: string;
    readonly email: string;
    readonly username: null;
    readonly passwordHash: string;
    readonly createdAt: number;
  }): Promise<Result<{ readonly id: string }, UserWriteFailure>>;
}

export type CreateCompanyInput = {
  readonly slug: string;
  readonly name: string;
  readonly rif: string;
  readonly industry?: string | null;
  readonly admin: {
    readonly name: string;
    readonly email: string;
    readonly password: string;
  };
};

export type CreateCompanyFailure =
  | 'slug_taken'
  | 'rif_taken'
  | 'email_taken'
  | 'invalid_slug'
  | 'invalid_rif'
  | 'weak_password';

export type CreateCompany = (
  input: CreateCompanyInput,
) => Promise<Result<CreatedCompany, CreateCompanyFailure>>;

export type CreateCompanyDeps = {
  readonly companies: CompanyRegistry;
  readonly users: CompanyAdminRegistry;
  readonly clock: Clock;
  readonly idGen: IdGen;
};

export function makeCreateCompany({
  companies,
  users,
  clock,
  idGen,
}: CreateCompanyDeps): CreateCompany {
  return async (input) => {
    // `normaliseSlug` is `isValidSlug` applied to the canonical form: it folds
    // 'Panadería La Espiga' to 'panaderia-la-espiga' and answers `null` for
    // anything that cannot become a slug at all. Judging the raw string
    // instead would reject a perfectly good name for its accent, and folding
    // without judging would let a non-canonical value become a primary key.
    const slug = normaliseSlug(input.slug);
    if (slug === null) return err('invalid_slug');

    // Two functions and both are needed: `normaliseRif` gives the canonical
    // 'J-07013380-5' shape, `isValidRif` checks the mod-11 digit. The RIF is
    // UNIQUE, so a typo that passes is a permanent squat on somebody else's
    // tax id.
    const rif = normaliseRif(input.rif);
    if (rif === null || !isValidRif(rif)) return err('invalid_rif');

    if (!isValidPassword(input.admin.password)) return err('weak_password');

    // Lower-cased and trimmed here because `findByEmail` matches the stored
    // value exactly — the repository will not fold it, on purpose, so that the
    // login lookup keeps riding `ux_users_email` instead of scanning.
    const email = input.admin.email.trim().toLowerCase();
    if ((await users.findByEmail(email)) !== null) return err('email_taken');

    const now = clock.nowSeconds();
    const created = await companies.create({
      id: slug,
      name: input.name.trim(),
      rif,
      industry: blankToNull(input.industry),
      createdAt: now,
    });

    if (!created.ok) {
      if (created.error === 'slug_taken' || created.error === 'rif_taken') {
        return err(created.error);
      }
      // `not_found` is an UPDATE's answer. An INSERT reporting it means the
      // repository changed shape under us, and there is nothing to decide.
      throw new AppError('internal', `company create returned ${created.error}`);
    }

    // Hashed after the company row lands rather than before it: PBKDF2 at 100k
    // iterations is real CPU on a Worker's budget, and the two refusals above
    // are the ones an admin actually hits.
    const adminName = input.admin.name.trim();
    const admin = await users.createUser({
      id: idGen.uuid(),
      companyId: created.value.id,
      // The company's own administrator. The only other role a merchant has is
      // `cashier`, created from their own panel (`employees/create-employee`)
      // with a username and a PIN. There is no tier between the two.
      role: 'company',
      name: adminName,
      email,
      // A `company` user is identified by their email; the CHECK constraint
      // refuses a username on any role but `cashier`.
      username: null,
      passwordHash: await hashPassword(input.admin.password),
      createdAt: now,
    });

    if (!admin.ok) {
      if (admin.error === 'email_taken') {
        // The race described at the top of the file. The company is standing
        // and nobody can sign into it; both of its unique columns are now
        // spent, so a retry cannot fix it without the platform team.
        logger.error('company_created_without_admin', { company: created.value.id });
        return err('email_taken');
      }
      throw new AppError('internal', `company admin create returned ${admin.error}`);
    }

    return ok({
      company: created.value,
      admin: { id: admin.value.id, name: adminName, email },
    });
  };
}

/** An industry left blank on the form means no industry, not an empty string. */
function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === '' ? null : trimmed;
}
