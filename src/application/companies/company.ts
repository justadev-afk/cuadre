/**
 * What a company *is*, as the admin area's use cases pass it around.
 *
 * It sits beside them rather than inside one of them because all four ports in
 * this folder return the same record and none of them owns it — the same
 * reason `src/application/session.ts` holds a session record without holding a
 * store. Nothing here is a port and nothing here reaches a database; a
 * repository that returns this shape satisfies the ports structurally, which
 * is what keeps `src/adapters/d1` out of every import list in this folder.
 */

export type CompanyStatus = 'active' | 'suspended';

export type Company = {
  /**
   * The slug — `companies.id`, the string a cashier types at the counter, and
   * the value every foreign key in the schema carries. Immutable from the
   * moment it is created: see `create-company.ts`, and note that
   * `update-company.ts` has no field for it.
   */
  readonly id: string;
  readonly name: string;
  readonly rif: string;
  readonly industry: string | null;
  readonly status: CompanyStatus;
  readonly createdAt: number;
};
