/**
 * Companies. `id` is the slug — the string a cashier types at the counter and
 * the string every foreign key carries — so this file never writes it after the
 * INSERT. `update` builds its SET clause from a patch that has no `id` field at
 * all, which is the cheapest way to make "never update the id" unforgettable.
 */
import { AppError } from '../../shared/errors.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { isUniqueIndex, readConstraintFailure, type UniqueIndex } from './constraint-error.ts';
import { type D1Row, integer, optionalText, text } from './row.ts';

export type CompanyStatus = 'active' | 'suspended';

export type Company = {
  /** The slug. Immutable once created. */
  readonly id: string;
  readonly name: string;
  readonly rif: string;
  readonly industry: string | null;
  readonly status: CompanyStatus;
  readonly createdAt: number;
};

/** A row of the platform admin's table: the company plus how alive it is. */
export type CompanyWithCounts = Company & {
  readonly cashierCount: number;
  readonly recentValidationCount: number;
};

export type NewCompany = {
  readonly id: string;
  readonly name: string;
  readonly rif: string;
  readonly industry: string | null;
  readonly createdAt: number;
};

export type CompanyPatch = {
  readonly name?: string;
  readonly industry?: string | null;
  readonly status?: CompanyStatus;
};

export type CompanyListQuery = {
  /** Matched against the name and the RIF. */
  readonly search?: string;
  readonly status?: CompanyStatus;
  /**
   * Epoch-seconds floor for `recentValidationCount`. "Last 30 days" is a
   * product decision and the caller is the one holding the `Clock`, so the
   * boundary arrives as a number instead of this file reading the time.
   */
  readonly activeSince: number;
  readonly limit?: number;
  readonly offset?: number;
};

export type CompanyListPage = {
  readonly items: readonly CompanyWithCounts[];
  /** Rows matching the filter, ignoring the page window. Drives the pager. */
  readonly total: number;
};

export type CompanyWriteFailure = 'slug_taken' | 'rif_taken' | 'not_found';

export interface CompanyRepository {
  create(input: NewCompany): Promise<Result<Company, CompanyWriteFailure>>;
  findById(id: string): Promise<Company | null>;
  list(query: CompanyListQuery): Promise<CompanyListPage>;
  update(id: string, patch: CompanyPatch): Promise<Result<Company, CompanyWriteFailure>>;
}

const SLUG_INDEX: UniqueIndex = { name: 'sqlite_autoindex_companies_1', columns: ['companies.id'] };
const RIF_INDEX: UniqueIndex = { name: 'sqlite_autoindex_companies_2', columns: ['companies.rif'] };

const COLUMNS = 'id, name, rif, industry, status, created_at';
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export class D1CompanyRepository implements CompanyRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<Company | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM companies WHERE id = ?`)
      .bind(id)
      .first<D1Row>();
    return row === null ? null : toCompany(row);
  }

  async create(input: NewCompany): Promise<Result<Company, CompanyWriteFailure>> {
    try {
      const row = await this.db
        .prepare(
          `INSERT INTO companies (id, name, rif, industry, created_at)
             VALUES (?, ?, ?, ?, ?)
             RETURNING ${COLUMNS}`,
        )
        .bind(input.id, input.name, input.rif, input.industry, input.createdAt)
        .first<D1Row>();

      if (row === null) throw new AppError('internal', 'company insert returned no row');
      return ok(toCompany(row));
    } catch (error) {
      const failure = readConstraintFailure(error);
      if (failure === null) throw error;
      if (isUniqueIndex(failure, RIF_INDEX)) return err('rif_taken');
      if (isUniqueIndex(failure, SLUG_INDEX)) return err('slug_taken');
      throw error;
    }
  }

  async list(query: CompanyListQuery): Promise<CompanyListPage> {
    const limit = clamp(query.limit);
    const offset = Math.max(0, query.offset ?? 0);
    const filter = buildFilter(query);

    // Two round trips rather than a windowed count: the admin table is the
    // only caller, its result set is small, and a `COUNT(*) OVER ()` would
    // make every row of every page carry the total.
    const [page, count] = await Promise.all([
      this.db
        .prepare(
          `SELECT c.id, c.name, c.rif, c.industry, c.status, c.created_at,
                    (SELECT COUNT(*) FROM users u
                      WHERE u.company_id = c.id AND u.role = 'cashier'
                        AND u.status = 'active') AS cashier_count,
                    (SELECT COUNT(*) FROM validations v
                      WHERE v.company_id = c.id AND v.is_sandbox = 0
                        AND v.created_at >= ?) AS recent_validation_count
               FROM companies c
              ${filter.where}
              ORDER BY c.created_at DESC
              LIMIT ? OFFSET ?`,
        )
        .bind(query.activeSince, ...filter.args, limit, offset)
        .all<D1Row>(),
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM companies c ${filter.where}`)
        .bind(...filter.args)
        .first<D1Row>(),
    ]);

    return {
      items: page.results.map(toCompanyWithCounts),
      total: count === null ? 0 : integer(count, 'total'),
    };
  }

  async update(id: string, patch: CompanyPatch): Promise<Result<Company, CompanyWriteFailure>> {
    const sets: string[] = [];
    const args: unknown[] = [];

    if (patch.name !== undefined) {
      sets.push('name = ?');
      args.push(patch.name);
    }
    if (patch.industry !== undefined) {
      sets.push('industry = ?');
      args.push(patch.industry);
    }
    if (patch.status !== undefined) {
      sets.push('status = ?');
      args.push(patch.status);
    }

    if (sets.length === 0) {
      const current = await this.findById(id);
      return current === null ? err('not_found') : ok(current);
    }

    const row = await this.db
      .prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id = ? RETURNING ${COLUMNS}`)
      .bind(...args, id)
      .first<D1Row>();

    return row === null ? err('not_found') : ok(toCompany(row));
  }
}

type Filter = { where: string; args: unknown[] };

function buildFilter(query: CompanyListQuery): Filter {
  const conditions: string[] = [];
  const args: unknown[] = [];

  const search = query.search?.trim();
  if (search !== undefined && search.length > 0) {
    // LIKE folds case for ASCII only, so "Bodegón" does not match "bodegon".
    // Accent folding needs a normalised search column; until a merchant asks,
    // the RIF — which is ASCII — is the reliable half of this search.
    conditions.push("(c.name LIKE ? ESCAPE '\\' OR c.rif LIKE ? ESCAPE '\\')");
    const pattern = `%${escapeLike(search)}%`;
    args.push(pattern, pattern);
  }

  if (query.status !== undefined) {
    conditions.push('c.status = ?');
    args.push(query.status);
  }

  return { where: conditions.length === 0 ? '' : `WHERE ${conditions.join(' AND ')}`, args };
}

/** `%` and `_` in a merchant's name are literal characters, not wildcards. */
function escapeLike(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');
}

function clamp(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(limit)));
}

export function toCompany(row: D1Row): Company {
  return {
    id: text(row, 'id'),
    name: text(row, 'name'),
    rif: text(row, 'rif'),
    industry: optionalText(row, 'industry'),
    status: toCompanyStatus(text(row, 'status')),
    createdAt: integer(row, 'created_at'),
  };
}

export function toCompanyWithCounts(row: D1Row): CompanyWithCounts {
  return {
    ...toCompany(row),
    cashierCount: integer(row, 'cashier_count'),
    recentValidationCount: integer(row, 'recent_validation_count'),
  };
}

/**
 * Fails closed. A status string this build does not recognise — a value added
 * by a later migration, read by an older deploy — must not read as an active
 * company, because "active" is what lets a counter take money.
 */
function toCompanyStatus(value: string): CompanyStatus {
  return value === 'active' ? 'active' : 'suspended';
}
