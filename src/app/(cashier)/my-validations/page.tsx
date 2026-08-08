/**
 * Screen 18 — the cashier's own list, with the Hoy / Ayer / 7 días filter and a
 * search box.
 *
 * The filter and the search both travel in the URL (`?range=…&q=…`), so the
 * state is shareable and the page stays a Server Component — the same shape the
 * company panel uses, and the same matcher (`validation-search.ts`), so a
 * cashier looks a payment up by reference, control code, phone or amount exactly
 * as their company does. The list is scoped to this cashier's id and this
 * company's id — a cashier sees their own work and nothing of the till beside
 * them.
 *
 * This is also the surface the express till links out to in a new tab, which is
 * why it carries a full search rather than the till's six-row "mi turno".
 */
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { cn } from '@/lib/utils.ts';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { NoValidations, ValidationList } from '../../_components/validation-list.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { queryValue, type SearchParams } from '../../_lib/inputs.ts';
import { pageMeta } from '../../_lib/page-meta.ts';

export const metadata = pageMeta('Mis validaciones');

type NamedRange = 'today' | 'yesterday' | 'last_7_days';

const RANGE_TABS: readonly { range: NamedRange; label: string }[] = [
  { range: 'today', label: 'Hoy' },
  { range: 'yesterday', label: 'Ayer' },
  { range: 'last_7_days', label: '7 días' },
];

export default async function MyValidationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { session } = await requireArea('counter');
  const detail = session.companyId
    ? await container().companies.getCompany({ companyId: session.companyId })
    : null;
  const merchantName = detail?.ok ? detail.value.company.name : undefined;
  const params = await searchParams;
  const range = readRange(queryValue(params, 'range'));
  const search = queryValue(params, 'q') ?? undefined;

  const list =
    session.companyId === null
      ? { items: [], from: 0, to: 0 }
      : await container().validations.listMyValidations({
          companyId: session.companyId,
          cashierId: session.userId,
          range,
          search,
        });

  const nowSeconds = Math.floor(list.to || Date.now() / 1000);

  return (
    <ContentLayout
      title="Mis validaciones"
      subtitle={`${list.items.length} ${list.items.length === 1 ? 'pago' : 'pagos'} en este rango`}
      actions={
        <form>
          {range !== 'today' && <input type="hidden" name="range" value={range} />}
          <Input
            name="q"
            defaultValue={search ?? ''}
            placeholder="Referencia, código, monto…"
            className="w-[210px]"
          />
        </form>
      }
    >
      <div className="inline-flex w-full items-stretch overflow-hidden rounded-md border border-border">
        {RANGE_TABS.map((tab) => (
          <a
            key={tab.range}
            href={hrefFor(tab.range, search)}
            className={cn(
              'inline-flex flex-1 items-center justify-center gap-1.5 border-l border-border px-3 py-[7px] text-[13px] text-foreground/70 no-underline transition-colors first:border-l-0 hover:bg-foreground/[0.06]',
              tab.range === range &&
                'text-primary shadow-[inset_0_0_0_1px_var(--primary)] hover:bg-transparent',
            )}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {list.items.length === 0 ? (
        search ? (
          <Card>
            <p className="m-0 py-5 text-center text-sm text-muted-foreground">
              No hay validaciones que coincidan con “{search}” en este rango.
            </p>
          </Card>
        ) : (
          <NoValidations cta={{ href: '/checkout', label: 'Validar un pago' }} />
        )
      ) : (
        <ValidationList items={list.items} nowSeconds={nowSeconds} merchantName={merchantName} />
      )}
    </ContentLayout>
  );
}

function hrefFor(range: NamedRange, search: string | undefined): string {
  const parts: string[] = [];
  if (range !== 'today') parts.push(`range=${range}`);
  if (search) parts.push(`q=${encodeURIComponent(search)}`);
  return parts.length === 0 ? '/my-validations' : `/my-validations?${parts.join('&')}`;
}

function readRange(value: string | null): NamedRange {
  if (value === 'yesterday' || value === 'last_7_days') return value;
  return 'today';
}
