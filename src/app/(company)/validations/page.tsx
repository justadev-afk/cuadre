/**
 * Screen 09 — the company's full list of validations, every cashier's work.
 *
 * Three filters, and all of them travel in the URL, so a view is shareable and
 * the page stays a Server Component: the environment, **whose work** — a person,
 * by id, because two cashiers called María are one shop's ordinary Tuesday and
 * the text search cannot tell them apart — and a free-text search.
 *
 * The two pickers are the same `SearchableSelect` the counter picks a bank with,
 * and they stay in the header: the environment is a switch a shop sets once
 * (usually never — one production bank, and the sandbox rows stop existing) and
 * the cashier one is a question asked at the end of a shift.
 *
 * The search box is neither. It is what somebody standing here with a receipt
 * reaches for, so it is a full-width row of its own between the day's totals and
 * the table it filters, and it searches by itself as the term is typed.
 *
 * **Which is why this screen has no `loading.tsx`.** A route skeleton replaces
 * the whole segment — the header, the pickers and the field being typed in — and
 * a field that is unmounted and rebuilt between two keystrokes loses the cursor
 * and everything after it. So the waiting happens *inside* the page: the shell
 * renders at once, and the two regions a filter actually changes hang behind
 * their own `Suspense`, keyed by the filter, drawn by the very components that
 * will replace them wearing `skeleton`. Nothing outside those two boxes moves,
 * and the cursor never leaves the search box.
 *
 * The three numbers over it are **today's**, and only today's — that is what
 * "cobrado hoy" says and it is the number a merchant closes the till against.
 * The table under them is the last seven days, because the other thing somebody
 * does on this screen is find the receipt a customer is holding, and that is
 * rarely from today. Two spans on one screen, each labelled with its own.
 *
 * What the URL cannot carry is time passing: the till goes on validating while
 * this screen sits open in the back office. So the header also holds an
 * *Actualizar* button, and the same soft refresh runs by itself every thirty
 * seconds — see `refresh-button.tsx`. It leaves the filter key alone, so a
 * refresh does not blink the table it is refreshing.
 *
 * The table is always drawn, even with nothing in it. A filter that returns
 * nothing has to keep showing the columns it was applied to — a screen that
 * replaces them with a box loses the very thing the merchant is adjusting — so
 * the "no results" card sits *under* the empty table.
 *
 * Everything is scoped by the session's `companyId`. There is no status column
 * because there are no unconfirmed rows: a row here is a confirmed payment.
 */

import Link from 'next/link';
import { Suspense } from 'react';

import { Button } from '@/components/ui/button.tsx';
import type { DailyTotalsResult } from '../../../application/validations/daily-totals.ts';
import { formatBolivares } from '../../../domain/money.ts';
import { systemClock } from '../../../shared/clock.ts';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { Icon } from '../../_components/icon.tsx';
import { StatCard } from '../../_components/stat-card.tsx';
import { ValidationList } from '../../_components/validation-list.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { queryValue, type SearchParams } from '../../_lib/inputs.ts';
import { pageMeta } from '../../_lib/page-meta.ts';
import { QueryFilterProvider } from '../../_lib/query-filter.tsx';
import { CashierFilter } from './cashier-filter.tsx';
import { type EnvFilter, EnvironmentFilter } from './environment-filter.tsx';
import { RefreshButton } from './refresh-button.tsx';
import { ValidationsPages } from './validations-pages.tsx';
import { ValidationsSearch } from './validations-search.tsx';

export const metadata = pageMeta('Validaciones');

/** Who a person is on this screen: the picker's options and the empty card's copy. */
type StaffMember = { readonly id: string; readonly name: string; readonly role: string };

export default async function ValidationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { companyId } = await requireCompany();
  const params = await searchParams;
  const environment = readEnv(queryValue(params, 'environment'));
  const search = queryValue(params, 'q') ?? undefined;

  // The people to choose from, and the one chosen. An id that is not on this
  // company's payroll is dropped rather than queried: the list is scoped by
  // `companyId` anyway, so it would return nothing — but a picker showing a
  // filter nobody can see is worse than one showing none.
  const staff = await container().employees.listEmployees({ companyId });
  const asked = queryValue(params, 'cashier') ?? '';
  const cashierId = staff.some((person) => person.id === asked) ? asked : '';

  // A merchant with no bank connected cannot validate anything — the counter has
  // nothing to ask. Say so here, where they land, rather than letting them find
  // out at the till with a customer waiting.
  const bankAccounts = await container().banking.listBankAccounts({ companyId });
  const hasBank = bankAccounts.some((a) => a.status !== 'removed');

  // Today, and nothing but today. The default is a week, and taking it was the
  // bug: three cards headed "hoy" were quietly summing the last seven days, so a
  // slow morning read as a good one because Tuesday was still in the number.
  const totals = container().validations.dailyTotals({ companyId, days: 1 });

  // The server's clock at this render, in milliseconds — the refresh button's
  // way of knowing its answer has landed. Milliseconds rather than the day's
  // end: two renders a second apart are common, two in the same millisecond are
  // not, and an unchanged value would leave the icon turning.
  const renderedAt = systemClock.nowMillis();

  // What makes the two regions blink: a *filter* changed, so the answer under
  // them is stale. `Actualizar` and the thirty-second refresh leave it alone.
  const filterKey = `${environment}|${cashierId}|${search ?? ''}`;

  return (
    <QueryFilterProvider>
      <ContentLayout
        title="Validaciones"
        subtitle={
          <Suspense fallback={<SubtitleSkeleton />}>
            <TotalsSubtitle totals={totals} />
          </Suspense>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <EnvironmentFilter value={environment} />
            <CashierFilter cashiers={staff} value={cashierId} />
            <RefreshButton renderedAt={renderedAt} />
          </div>
        }
      >
        {!hasBank && (
          <div className="flex items-center gap-3.5 rounded-md bg-primary/[0.08] p-4 ring-1 ring-inset ring-primary/35">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[var(--color-accent-800)] text-xl text-[var(--color-accent-100)]">
              <Icon name="bank" />
            </span>
            <div className="flex-1">
              <div className="font-heading text-[15px]">
                Conecta un banco para empezar a validar
              </div>
              <span className="text-xs text-muted-foreground">
                Sin una cuenta conectada, la caja no tiene a quién preguntarle por un pago.
              </span>
            </div>
            <Button asChild className="whitespace-nowrap">
              <Link href="/banks">
                <Icon name="plus" />
                Conectar banco
              </Link>
            </Button>
          </div>
        )}

        <Suspense key={`totals:${filterKey}`} fallback={<TotalsCards />}>
          <TotalsCards totals={totals} />
        </Suspense>

        {/* Outside every boundary, on purpose: this is the element that must not
            be rebuilt while the server answers, because somebody is typing in it. */}
        <ValidationsSearch value={search ?? ''} />

        <Suspense key={`list:${filterKey}`} fallback={<ValidationsTable skeleton />}>
          <ValidationsTable
            companyId={companyId}
            environment={environment}
            cashierId={cashierId}
            search={search}
            staff={staff}
          />
        </Suspense>
      </ContentLayout>
    </QueryFilterProvider>
  );
}

/**
 * The day's line under the title. Its own boundary, and unkeyed: the totals do
 * not read the filters, so re-asking them is not a reason to blink a heading.
 */
async function TotalsSubtitle({ totals }: { totals: Promise<DailyTotalsResult> }) {
  const day = await totals;
  return `Hoy · ${day.totalCount} ${day.totalCount === 1 ? 'pago validado' : 'pagos validados'} · ${formatBolivares(day.totalAmountCents)}`;
}

function SubtitleSkeleton() {
  return (
    <span className="sk-mask">
      {/* Text under a bar, never a bar instead of text: the placeholder keeps
          the line's own metrics, so the header is exactly as tall as it will be
          and the page below it does not step up when the totals land. */}
      <span data-sk="line" className="inline-block">
        Hoy · 0 pagos validados · Bs 0,00
      </span>
    </span>
  );
}

/**
 * The three numbers. With no `totals` it is its own skeleton — the same three
 * boxes, the same labels, the same heights, with a bar where each number goes.
 */
async function TotalsCards({ totals }: { totals?: Promise<DailyTotalsResult> }) {
  if (totals === undefined) {
    return (
      <div className="flex flex-wrap gap-3">
        <StatCard skeleton kicker="Cobrado hoy" />
        <StatCard skeleton kicker="Ticket promedio" />
        <StatCard skeleton kicker="Pagos validados" />
      </div>
    );
  }

  const day = await totals;
  const avgCents = day.totalCount === 0 ? 0 : Math.round(day.totalAmountCents / day.totalCount);

  return (
    <div className="flex flex-wrap gap-3">
      <StatCard
        kicker="Cobrado hoy"
        value={formatBolivares(day.totalAmountCents)}
        note={`${day.totalCount} pagos aprobados`}
      />
      <StatCard kicker="Ticket promedio" value={formatBolivares(avgCents)} note="excluye sandbox" />
      <StatCard kicker="Pagos validados" value={String(day.totalCount)} note="hoy" />
    </div>
  );
}

/**
 * The list itself: the first page, rendered here, handed to the client view
 * that pages and prefetches from it. `skeleton` renders the same table — same
 * head, same columns — with rows of bars, so what lands lands where the
 * placeholder was.
 *
 * The range is the use case's own — the last seven Venezuelan days, resolved
 * against the clock when it is asked rather than when this rendered. The
 * *today* the cards above show is a different question and is asked separately.
 */
async function ValidationsTable(
  props:
    | { readonly skeleton: true }
    | {
        readonly skeleton?: false;
        readonly companyId: string;
        readonly environment: EnvFilter;
        readonly cashierId: string;
        readonly search: string | undefined;
        readonly staff: readonly StaffMember[];
      },
) {
  if (props.skeleton === true) {
    return (
      <div className="flex flex-col gap-2">
        <ListHeading />
        <ValidationList skeleton showCashier />
      </div>
    );
  }

  const { companyId, environment, cashierId, search, staff } = props;
  const companyDetail = await container().companies.getCompany({ companyId });
  const list = await container().validations.listValidations({
    companyId,
    environment,
    cashierId: cashierId === '' ? undefined : cashierId,
    search,
  });

  return (
    <div className="flex flex-col gap-2">
      <ListHeading />
      <ValidationsPages
        initialItems={list.items}
        initialNextCursor={list.nextCursor}
        initialNowSeconds={list.to}
        environment={environment}
        cashierId={cashierId}
        search={search ?? ''}
        merchantName={companyDetail.ok ? companyDetail.value.company.name : undefined}
        merchantRif={companyDetail.ok ? companyDetail.value.company.rif : undefined}
        emptyMessage={emptyMessage(cashierId, staff, search, environment)}
      />
    </div>
  );
}

/**
 * The cards above say "hoy"; this says what the table is. Two spans on one
 * screen, and neither of them left for the reader to infer. It is drawn by the
 * placeholder too, so it does not pop in when the rows land.
 */
function ListHeading() {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h6 className="m-0 text-primary">Últimos 7 días</h6>
      <Link
        href="/statistics"
        className="text-xs text-muted-foreground no-underline transition-colors hover:text-primary"
      >
        Ver estadísticas
      </Link>
    </div>
  );
}

/**
 * What the empty box says. It names the filter that emptied the list, because
 * "no hay validaciones" under a table the merchant just narrowed reads as "you
 * have no payments" — which is a different and much more alarming sentence.
 */
function emptyMessage(
  cashierId: string,
  staff: readonly { readonly id: string; readonly name: string }[],
  search: string | undefined,
  environment: EnvFilter,
): string {
  const person = staff.find((member) => member.id === cashierId);
  if (person !== undefined && search) {
    return `${person.name} no tiene validaciones que coincidan con «${search}».`;
  }
  if (person !== undefined) return `${person.name} no tiene validaciones en los últimos 7 días.`;
  if (search) return `Ninguna validación coincide con «${search}».`;
  if (environment === 'sandbox') return 'No hay validaciones de prueba en los últimos 7 días.';
  return 'No hay validaciones en los últimos 7 días.';
}

function readEnv(value: string | null): EnvFilter {
  if (value === 'production' || value === 'sandbox') return value;
  return 'all';
}
