/**
 * Screen 09 — the company's full list of validations, every cashier's work.
 *
 * The environment filter (Todos / Producción / Sandbox) travels in the URL, so
 * the view is shareable and the page stays a Server Component. The stat band is
 * today's totals, which by construction exclude sandbox — a cash total that
 * counted test payments would be a lie the panel tells every morning.
 *
 * Everything is scoped by the session's `companyId`. There is no status column
 * because there are no unconfirmed rows: a row here is a confirmed payment.
 */

import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { cn } from '@/lib/utils.ts';
import { formatBolivares } from '../../../domain/money.ts';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { Icon } from '../../_components/icon.tsx';
import { ValidationList } from '../../_components/validation-list.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { queryValue, type SearchParams } from '../../_lib/inputs.ts';
import { pageMeta } from '../../_lib/page-meta.ts';

export const metadata = pageMeta('Validaciones');

type EnvFilter = 'all' | 'production' | 'sandbox';

const ENV_TABS: readonly { value: EnvFilter; label: string; icon?: 'flask' }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'production', label: 'Producción' },
  { value: 'sandbox', label: 'Sandbox', icon: 'flask' },
];

export default async function ValidationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { companyId } = await requireCompany();
  const companyDetail = await container().companies.getCompany({ companyId });
  const merchantName = companyDetail.ok ? companyDetail.value.company.name : undefined;
  const params = await searchParams;
  const environment = readEnv(queryValue(params, 'environment'));
  const search = queryValue(params, 'q') ?? undefined;

  const totals = await container().validations.dailyTotals({ companyId });
  const list = await container().validations.listValidations({
    companyId,
    from: totals.from,
    to: totals.to,
    environment,
    search,
  });

  // A merchant with no bank connected cannot validate anything — the counter has
  // nothing to ask. Say so here, where they land, rather than letting them find
  // out at the till with a customer waiting.
  const bankAccounts = await container().banking.listBankAccounts({ companyId });
  const hasBank = bankAccounts.some((a) => a.status !== 'removed');

  const nowSeconds = totals.to;
  const avgCents =
    totals.totalCount === 0 ? 0 : Math.round(totals.totalAmountCents / totals.totalCount);

  return (
    <ContentLayout
      title="Validaciones"
      subtitle={`Hoy · ${totals.totalCount} pagos validados · ${formatBolivares(totals.totalAmountCents)}`}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-stretch overflow-hidden rounded-md border border-border">
            {ENV_TABS.map((tab) => (
              <a
                key={tab.value}
                href={hrefFor(tab.value, search)}
                className={cn(
                  'inline-flex items-center gap-1.5 border-l border-border px-3 py-[7px] text-[13px] text-foreground/70 no-underline transition-colors first:border-l-0 hover:bg-foreground/[0.06]',
                  tab.value === environment &&
                    'text-primary shadow-[inset_0_0_0_1px_var(--primary)] hover:bg-transparent',
                )}
              >
                {tab.icon && <Icon name={tab.icon} />}
                {tab.label}
              </a>
            ))}
          </div>
          <form>
            {environment !== 'all' && (
              <input type="hidden" name="environment" value={environment} />
            )}
            <Input
              name="q"
              defaultValue={search ?? ''}
              placeholder="Referencia, monto, cajero…"
              className="w-[210px]"
            />
          </form>
        </div>
      }
    >
      {!hasBank && (
        <div className="flex items-center gap-3.5 rounded-md bg-primary/[0.08] p-4 ring-1 ring-inset ring-primary/35">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--color-accent-800)] text-xl text-[var(--color-accent-100)]">
            <Icon name="bank" />
          </span>
          <div className="flex-1">
            <div className="font-heading text-[15px]">Conecta un banco para empezar a validar</div>
            <span className="text-xs text-muted-foreground">
              Sin una cuenta conectada, la caja no tiene a quién preguntarle por un pago.
            </span>
          </div>
          <Button asChild className="whitespace-nowrap">
            <a href="/banks">
              <Icon name="plus" />
              Conectar banco
            </a>
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        <StatCard
          kicker="Cobrado hoy"
          value={formatBolivares(totals.totalAmountCents)}
          note={`${totals.totalCount} pagos aprobados`}
        />
        <StatCard
          kicker="Ticket promedio"
          value={formatBolivares(avgCents)}
          note="excluye sandbox"
        />
        <StatCard kicker="Pagos validados" value={String(totals.totalCount)} note="hoy" />
      </div>

      {list.items.length === 0 ? (
        <Card>
          <p className="m-0 py-5 text-center text-sm text-muted-foreground">
            No hay validaciones en este filtro.
          </p>
        </Card>
      ) : (
        <ValidationList
          items={list.items}
          nowSeconds={nowSeconds}
          showCashier
          merchantName={merchantName}
        />
      )}
    </ContentLayout>
  );
}

function StatCard({ kicker, value, note }: { kicker: string; value: string; note: string }) {
  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-0.5 rounded-md bg-card p-3 shadow-[var(--shadow-sm)]">
      <div className="text-[10px] tracking-[0.1em] text-primary uppercase">{kicker}</div>
      <div className="font-heading text-2xl">{value}</div>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

function hrefFor(env: EnvFilter, search: string | undefined): string {
  const parts: string[] = [];
  if (env !== 'all') parts.push(`environment=${env}`);
  if (search) parts.push(`q=${encodeURIComponent(search)}`);
  return parts.length === 0 ? '/validations' : `/validations?${parts.join('&')}`;
}

function readEnv(value: string | null): EnvFilter {
  if (value === 'production' || value === 'sandbox') return value;
  return 'all';
}
