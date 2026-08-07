/**
 * Screen 18 — the cashier's own list, with the Hoy / Ayer / 7 días filter.
 *
 * The filter is three links, not a script: it travels in the URL (`?range=…`),
 * so the state is shareable and the page stays a Server Component. The list is
 * scoped to this cashier's id and this company's id — a cashier sees their own
 * work and nothing of the till beside them.
 */
import { ContentLayout } from '../../_components/content-layout.tsx';
import { NoValidations, ValidationCards } from '../../_components/validation-list.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { queryValue, type SearchParams } from '../../_lib/inputs.ts';

export const metadata = { title: 'Mis validaciones · Cuadre' };

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
  const params = await searchParams;
  const range = readRange(queryValue(params, 'range'));

  const list =
    session.companyId === null
      ? { items: [], from: 0, to: 0 }
      : await container().validations.listMyValidations({
          companyId: session.companyId,
          cashierId: session.userId,
          range,
        });

  const nowSeconds = Math.floor(list.to || Date.now() / 1000);

  return (
    <ContentLayout
      title="Mis validaciones"
      subtitle={`${list.items.length} ${list.items.length === 1 ? 'pago' : 'pagos'} en este rango`}
    >
      <div className="seg" style={{ width: '100%' }}>
        {RANGE_TABS.map((tab) => (
          <a
            key={tab.range}
            href={`/my-validations?range=${tab.range}`}
            className="seg-opt"
            style={{
              flex: 1,
              justifyContent: 'center',
              ...(tab.range === range
                ? {
                    color: 'var(--color-accent)',
                    boxShadow: 'inset 0 0 0 1px var(--color-accent)',
                  }
                : {}),
            }}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {list.items.length === 0 ? (
        <NoValidations cta={{ href: '/checkout', label: 'Validar un pago' }} />
      ) : (
        <ValidationCards items={list.items} nowSeconds={nowSeconds} />
      )}
    </ContentLayout>
  );
}

function readRange(value: string | null): NamedRange {
  if (value === 'yesterday' || value === 'last_7_days') return value;
  return 'today';
}
