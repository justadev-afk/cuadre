/**
 * Screen 06 — the admin's list of companies.
 *
 * Desktop is a table, phone is cards; the same rows, laid out for the width.
 * Search and the status filter travel in the URL so the view is shareable and
 * the page stays a Server Component. "Nueva empresa" is the one interactive
 * leaf, a dialog.
 */
import Link from 'next/link';

import { AppNav } from '../../_components/app-nav.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { queryValue, type SearchParams } from '../../_lib/inputs.ts';
import { ADMIN_LINKS } from '../_lib/nav.ts';
import { NewCompanyDialog } from './new-company-dialog.tsx';

export const metadata = { title: 'Empresas · Cuadre' };

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { session } = await requireArea('admin');
  const params = await searchParams;
  const search = queryValue(params, 'q') ?? undefined;
  const status = readStatus(queryValue(params, 'status'));

  const { items, total } = await container().companies.listCompanies({ search, status });
  const activeCount = items.filter((c) => c.status === 'active').length;
  const suspendedCount = items.filter((c) => c.status === 'suspended').length;

  return (
    <>
      <AppNav links={ADMIN_LINKS} current="/admin/companies" roleLabel="Admin" who={session.name} />

      <main style={{ padding: '28px 24px', maxWidth: 1120, marginInline: 'auto', width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 20,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <h4 style={{ margin: '0 0 2px' }}>Empresas</h4>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {activeCount} {activeCount === 1 ? 'activa' : 'activas'}
              {suspendedCount > 0 &&
                ` · ${suspendedCount} suspendida${suspendedCount === 1 ? '' : 's'}`}{' '}
              · {total} en total
            </span>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <form>
              <input
                className="input"
                name="q"
                defaultValue={search ?? ''}
                placeholder="Buscar por nombre o RIF"
                style={{ width: 220 }}
              />
            </form>
            <NewCompanyDialog />
          </div>
        </div>

        {items.length === 0 ? (
          <p
            className="text-muted"
            style={{ fontSize: 14, padding: '32px 0', textAlign: 'center' }}
          >
            No hay empresas que coincidan.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>RIF</th>
                  <th>Código</th>
                  <th>Cajeros</th>
                  <th>Validaciones (30d)</th>
                  <th>Estado</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((company) => (
                  <tr key={company.id}>
                    <td style={{ fontFamily: 'var(--font-heading)' }}>{company.name}</td>
                    <td className="text-muted">{company.rif}</td>
                    <td className="text-muted tnum">{company.id}</td>
                    <td>{company.cashierCount}</td>
                    <td className="tnum">{company.recentValidationCount}</td>
                    <td>
                      <span
                        className={
                          company.status === 'active' ? 'tag tag-accent' : 'tag tag-neutral'
                        }
                      >
                        {company.status === 'active' ? 'Activa' : 'Suspendida'}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <Link
                        href={`/admin/companies/${company.id}`}
                        className="btn btn-ghost"
                        style={{ fontSize: 13 }}
                      >
                        Bancos
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}

function readStatus(value: string | null): 'active' | 'suspended' | undefined {
  if (value === 'active' || value === 'suspended') return value;
  return undefined;
}
