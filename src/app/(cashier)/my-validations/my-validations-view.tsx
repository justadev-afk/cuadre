'use client';

/**
 * Screen 18, driven on the client so the day tabs switch *instantly*.
 *
 * The old version navigated the whole route per tab, which flashed a route
 * skeleton over the header — the title, the tabs and the search box all blinked
 * out and back. Here the header is always on screen and only the list changes:
 * a tab click highlights immediately (local state) and the rows fetch behind a
 * quiet dim, never a skeleton. Search and the ten-at-a-time paging reach the
 * same `fetchMyValidations` action; a stale response is dropped by request id,
 * so fast clicks never render out of order.
 *
 * The first page is server-rendered and handed in, so the initial paint has its
 * rows already — no client round trip before anything shows.
 */
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { cn } from '@/lib/utils.ts';
import type { Validation } from '../../../adapters/d1/validation.repository.ts';
import type { NamedRange } from '../../../application/validations/day-range.ts';
import type { PageCursor } from '../../../application/validations/list-validations.ts';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { Icon } from '../../_components/icon.tsx';
import { NoValidations, ValidationList } from '../../_components/validation-list.tsx';
import { fetchMyValidations } from './my-validations-actions.ts';

const RANGE_TABS: readonly { range: NamedRange; label: string }[] = [
  { range: 'today', label: 'Hoy' },
  { range: 'yesterday', label: 'Ayer' },
  { range: 'last_7_days', label: '7 días' },
];

const RANGE_LABEL: Record<NamedRange, string> = {
  today: 'Hoy',
  yesterday: 'Ayer',
  last_7_days: 'Últimos 7 días',
};

/** The empty state reads the range — "hoy" is only right on today's list. */
const RANGE_EMPTY: Record<NamedRange, { title: string; hint: string }> = {
  today: {
    title: 'Todavía no validas nada hoy',
    hint: 'El primer cobro del día aparecerá aquí.',
  },
  yesterday: {
    title: 'No validaste nada ayer',
    hint: 'Ese día no quedó ningún cobro tuyo.',
  },
  last_7_days: {
    title: 'Sin validaciones en 7 días',
    hint: 'No hay cobros tuyos en la última semana.',
  },
};

type MyValidationsViewProps = {
  initialItems: readonly Validation[];
  initialNextCursor: PageCursor | null;
  initialNowSeconds: number;
  merchantName?: string;
};

export function MyValidationsView({
  initialItems,
  initialNextCursor,
  initialNowSeconds,
  merchantName,
}: MyValidationsViewProps) {
  const [range, setRange] = useState<NamedRange>('today');
  const [searchInput, setSearchInput] = useState('');
  const [committedSearch, setCommittedSearch] = useState('');
  const [items, setItems] = useState<readonly Validation[]>(initialItems);
  const [nextCursor, setNextCursor] = useState<PageCursor | null>(initialNextCursor);
  const [nowSeconds, setNowSeconds] = useState(initialNowSeconds);
  // The cursor that starts each page seen so far — `[null]` is page 1.
  const [starts, setStarts] = useState<(PageCursor | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(false);

  // Last request wins: a slow page that resolves after a newer click is dropped.
  const reqId = useRef(0);

  async function load(next: {
    range: NamedRange;
    search: string;
    cursor: PageCursor | null;
    starts: (PageCursor | null)[];
    pageIndex: number;
  }): Promise<void> {
    // Highlight and page state update now, so the tab switch reads as instant.
    setRange(next.range);
    setCommittedSearch(next.search);
    setStarts(next.starts);
    setPageIndex(next.pageIndex);
    setLoading(true);

    const mine = ++reqId.current;
    const page = await fetchMyValidations({
      range: next.range,
      search: next.search,
      cursor: next.cursor,
    });
    if (reqId.current !== mine) return;

    setItems(page.items);
    setNextCursor(page.nextCursor);
    setNowSeconds(page.nowSeconds);
    setLoading(false);
  }

  const changeRange = (r: NamedRange): void => {
    if (r === range) return;
    void load({ range: r, search: committedSearch, cursor: null, starts: [null], pageIndex: 0 });
  };

  const runSearch = (): void => {
    void load({ range, search: searchInput, cursor: null, starts: [null], pageIndex: 0 });
  };

  const goNext = (): void => {
    if (nextCursor === null) return;
    void load({
      range,
      search: committedSearch,
      cursor: nextCursor,
      starts: [...starts, nextCursor],
      pageIndex: pageIndex + 1,
    });
  };

  const goPrev = (): void => {
    if (pageIndex === 0) return;
    const target = pageIndex - 1;
    void load({
      range,
      search: committedSearch,
      cursor: starts[target] ?? null,
      starts: starts.slice(0, target + 1),
      pageIndex: target,
    });
  };

  const hasPages = pageIndex > 0 || nextCursor !== null;

  return (
    <ContentLayout
      title="Mis validaciones"
      subtitle={`${RANGE_LABEL[range]} · ${items.length} ${items.length === 1 ? 'pago' : 'pagos'} en esta página`}
      actions={
        <form
          onSubmit={(event) => {
            event.preventDefault();
            runSearch();
          }}
        >
          <Input
            name="q"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Referencia, código, monto…"
            className="w-[210px]"
          />
        </form>
      }
    >
      <div className="inline-flex w-full items-stretch overflow-hidden rounded-md border border-border">
        {RANGE_TABS.map((tab) => (
          <button
            key={tab.range}
            type="button"
            onClick={() => changeRange(tab.range)}
            aria-current={tab.range === range ? 'true' : undefined}
            className={cn(
              'inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 border-l border-border bg-transparent px-3 py-[7px] text-[13px] text-foreground/70 transition-colors first:border-l-0 hover:bg-foreground/[0.06]',
              tab.range === range &&
                'text-primary shadow-[inset_0_0_0_1px_var(--primary)] hover:bg-transparent',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className={cn('transition-opacity', loading && 'pointer-events-none opacity-60')}>
        {items.length === 0 ? (
          committedSearch ? (
            <Card>
              <p className="m-0 py-5 text-center text-sm text-muted-foreground">
                No hay validaciones que coincidan con “{committedSearch}” en este rango.
              </p>
            </Card>
          ) : (
            <NoValidations
              title={RANGE_EMPTY[range].title}
              hint={RANGE_EMPTY[range].hint}
              cta={range === 'today' ? { href: '/checkout', label: 'Validar un pago' } : undefined}
            />
          )
        ) : (
          <ValidationList items={items} nowSeconds={nowSeconds} merchantName={merchantName} />
        )}

        {hasPages && (
          <div className="mt-3 flex items-center justify-between">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={goPrev}
              disabled={pageIndex === 0 || loading}
            >
              <Icon name="arrow-left" />
              Anterior
            </Button>
            <span className="text-xs text-muted-foreground">Página {pageIndex + 1}</span>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={goNext}
              disabled={nextCursor === null || loading}
            >
              Siguiente
              <Icon name="arrow-right" />
            </Button>
          </div>
        )}
      </div>
    </ContentLayout>
  );
}
