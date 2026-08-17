/**
 * Screen 09 — the company's full list of validations, every cashier's work.
 *
 * Three filters, and all of them travel in the URL, so a view is shareable and
 * the page stays a Server Component: the environment, **whose work** — a person,
 * by id, because two cashiers called María are one shop's ordinary Tuesday and
 * the text search cannot tell them apart — and a free-text search.
 *
 * The two pickers are the same `SearchableSelect` the counter picks a bank with,
 * and the header is ordered by how often a hand reaches for it: the environment
 * is a switch a shop sets once (usually never — one production bank, and the
 * sandbox rows stop existing), so it is a closed control rather than the strip
 * of tabs it used to be, and the search box got the room. Somebody standing here
 * with a receipt is looking for a reference.
 *
 * What the URL cannot carry is time passing: the till goes on validating while
 * this screen sits open in the back office. So the header also holds an
 * *Actualizar* button, and the same soft refresh runs by itself every thirty
 * seconds — see `refresh-button.tsx`.
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

import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Input } from '@/components/ui/input.tsx';
import { formatBolivares } from '../../../domain/money.ts';
import { systemClock } from '../../../shared/clock.ts';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { Icon } from '../../_components/icon.tsx';
import { ValidationList } from '../../_components/validation-list.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { queryValue, type SearchParams } from '../../_lib/inputs.ts';
import { pageMeta } from '../../_lib/page-meta.ts';
import { CashierFilter } from './cashier-filter.tsx';
import { type EnvFilter, EnvironmentFilter } from './environment-filter.tsx';
import { RefreshButton } from './refresh-button.tsx';

export const metadata = pageMeta('Validaciones');

export default async function ValidationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { companyId } = await requireCompany();
  const companyDetail = await container().companies.getCompany({ companyId });
  const merchantName = companyDetail.ok ? companyDetail.value.company.name : undefined;
  const merchantRif = companyDetail.ok ? companyDetail.value.company.rif : undefined;
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

  const totals = await container().validations.dailyTotals({ companyId });
  const list = await container().validations.listValidations({
    companyId,
    from: totals.from,
    to: totals.to,
    environment,
    cashierId: cashierId === '' ? undefined : cashierId,
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
          <EnvironmentFilter value={environment} />
          <CashierFilter cashiers={staff} value={cashierId} />
          <form>
            {environment !== 'all' && (
              <input type="hidden" name="environment" value={environment} />
            )}
            {cashierId !== '' && <input type="hidden" name="cashier" value={cashierId} />}
            {/* The widest thing in the header, now that the environment is one
                closed control: this is what somebody reaches for with a receipt
                in their hand. */}
            <Input
              name="q"
              defaultValue={search ?? ''}
              placeholder="Referencia, monto, cajero…"
              className="w-[280px] max-[899px]:w-[210px]"
            />
          </form>
          {/* The clock of *this* render, so the button knows when a refresh it
              asked for has landed. Milliseconds rather than `totals.to`: two
              renders a second apart are common, two in the same millisecond are
              not, and an unchanged value would leave the icon turning. */}
          <RefreshButton renderedAt={systemClock.nowMillis()} />
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
            <Link href="/banks">
              <Icon name="plus" />
              Conectar banco
            </Link>
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

      {/* Always drawn, empty or not — see the note at the top of the file. */}
      <ValidationList
        items={list.items}
        nowSeconds={nowSeconds}
        showCashier
        merchantName={merchantName}
        merchantRif={merchantRif}
      />

      {list.items.length === 0 && (
        <Card>
          <p className="m-0 py-5 text-center text-sm text-muted-foreground">
            {emptyMessage(cashierId, staff, search, environment)}
          </p>
        </Card>
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
  if (person !== undefined) return `${person.name} no tiene validaciones en este período.`;
  if (search) return `Ninguna validación coincide con «${search}».`;
  if (environment === 'sandbox') return 'No hay validaciones de prueba en este período.';
  return 'No hay validaciones en este filtro.';
}

function readEnv(value: string | null): EnvFilter {
  if (value === 'production' || value === 'sandbox') return value;
  return 'all';
}
