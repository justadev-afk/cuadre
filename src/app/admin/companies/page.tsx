/**
 * Screen 06 — the admin's list of companies.
 *
 * Each row links into that company's detail. Search and the status filter
 * travel in the URL so the view is shareable and the page stays a Server
 * Component; "Nueva empresa" is the one interactive leaf, a dialog.
 */
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { queryValue, type SearchParams } from '../../_lib/inputs.ts';
import { CompaniesTable } from './companies-table.tsx';
import { NewCompanyDialog } from './new-company-dialog.tsx';

export const metadata = { title: 'Empresas · Cuadre' };

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireArea('admin');
  const params = await searchParams;
  const search = queryValue(params, 'q') ?? undefined;
  const status = readStatus(queryValue(params, 'status'));

  const { items, total } = await container().companies.listCompanies({ search, status });
  const activeCount = items.filter((c) => c.status === 'active').length;
  const suspendedCount = items.filter((c) => c.status === 'suspended').length;

  const rows = items.map((company) => ({
    id: company.id,
    name: company.name,
    rif: company.rif,
    status: company.status,
    cashierCount: company.cashierCount,
    recentValidationCount: company.recentValidationCount,
  }));

  return (
    <ContentLayout
      title="Empresas"
      subtitle={`${activeCount} ${activeCount === 1 ? 'activa' : 'activas'}${
        suspendedCount > 0
          ? ` · ${suspendedCount} suspendida${suspendedCount === 1 ? '' : 's'}`
          : ''
      } · ${total} en total`}
      actions={
        <div className="flex items-center gap-2">
          <form>
            <Input
              name="q"
              defaultValue={search ?? ''}
              placeholder="Buscar por nombre o RIF"
              className="w-[220px]"
            />
          </form>
          <NewCompanyDialog />
        </div>
      }
    >
      {rows.length === 0 ? (
        <Card>
          <p className="m-0 py-5 text-center text-sm text-muted-foreground">
            No hay empresas que coincidan.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <CompaniesTable companies={rows} />
        </Card>
      )}
    </ContentLayout>
  );
}

function readStatus(value: string | null): 'active' | 'suspended' | undefined {
  if (value === 'active' || value === 'suspended') return value;
  return undefined;
}
