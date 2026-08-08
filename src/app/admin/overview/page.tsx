/**
 * The platform overview — the admin's landing dashboard. How many companies
 * exist, how many are live, how much validating happened lately, and the same
 * clickable company table the "Empresas" screen shows, so a company is one
 * click away from here too.
 *
 * The counts come from the company directory the list already uses; the
 * "validaciones (30d)" figure is the sum of each company's own real-validation
 * count over the last thirty days, which the directory already computes per row.
 */
import { Card } from '@/components/ui/card.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { pageMeta } from '../../_lib/page-meta.ts';
import { CompaniesTable } from '../companies/companies-table.tsx';

export const metadata = pageMeta('Resumen');

export default async function AdminOverviewPage() {
  await requireArea('admin');

  const [all, active] = await Promise.all([
    container().companies.listCompanies({ limit: 100 }),
    container().companies.listCompanies({ status: 'active' }),
  ]);

  const validations30d = all.items.reduce((sum, c) => sum + c.recentValidationCount, 0);
  const withActivity = all.items.filter((c) => c.recentValidationCount > 0).length;

  const rows = all.items.map((company) => ({
    id: company.id,
    name: company.name,
    rif: company.rif,
    status: company.status,
    cashierCount: company.cashierCount,
    recentValidationCount: company.recentValidationCount,
  }));

  return (
    <ContentLayout title="Resumen" subtitle="Actividad de la plataforma">
      <div className="flex flex-wrap gap-3">
        <Stat kicker="Empresas" value={String(all.total)} note={`${active.total} activas`} />
        <Stat kicker="Con actividad (30d)" value={String(withActivity)} note="empresas" />
        <Stat kicker="Validaciones (30d)" value={String(validations30d)} note="en la plataforma" />
      </div>

      <div>
        <h6 className="mb-2 text-primary">Empresas</h6>
        {rows.length === 0 ? (
          <Card>
            <p className="m-0 py-5 text-center text-sm text-muted-foreground">
              Todavía no hay empresas.
            </p>
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <CompaniesTable companies={rows} />
          </Card>
        )}
      </div>
    </ContentLayout>
  );
}

function Stat({ kicker, value, note }: { kicker: string; value: string; note: string }) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-0.5 rounded-md bg-card px-[18px] py-4 shadow-[var(--shadow-sm)]">
      <div className="text-[10px] tracking-[0.1em] text-primary uppercase">{kicker}</div>
      <div className="font-heading text-2xl">{value}</div>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}
