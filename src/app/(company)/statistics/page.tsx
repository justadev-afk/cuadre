/**
 * Estadísticas — the questions that come after "¿cuánto llevo hoy?".
 *
 * The panel a merchant lands on is about *now*: today's takings and the last
 * week's receipts. This screen is about shape — which days carry the week, what
 * time the counter actually moves, who is behind it, which bank the customers
 * pay from, and whether the transferencia is worth keeping the field for. All of
 * it over a span they choose.
 *
 * **One range, one query.** Everything below the header is six GROUP BYs in a
 * single D1 batch (`validationStats`), so changing the span costs one round trip
 * rather than one per card. The span is on the URL — a preset, or two days off
 * the calendar — which is what makes a view shareable and reloadable, and what
 * keeps this a Server Component.
 *
 * **Sandbox is not here at all.** Not as a filter, not as a toggle: every number
 * on this screen is money, and a test payment is not money (§5). That is also
 * why the environment picker from the panel is absent — there is nothing here
 * for it to switch between.
 *
 * **It has a `loading.tsx`, and the panel deliberately does not.** The reason
 * the panel could not have one is its search box: a route skeleton unmounts the
 * field between two keystrokes. Nothing here is typed into — a dropdown and a
 * calendar are both one-shot gestures — so the whole route may blink, and the
 * simpler thing is the right one.
 */
import { Alert, AlertDescription } from '@/components/ui/alert.tsx';
import { Card } from '@/components/ui/card.tsx';
import type {
  DayPoint,
  HourPoint,
  ValidationStatsView,
} from '../../../application/validations/validation-stats.ts';
import { MAX_STATS_DAYS } from '../../../application/validations/validation-stats.ts';
import { formatBolivares } from '../../../domain/money.ts';
import { ColumnChart } from '../../_components/column-chart.tsx';
import { type ColumnPoint, peakOf } from '../../_components/column-points.ts';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { Icon } from '../../_components/icon.tsx';
import { StatCard } from '../../_components/stat-card.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { queryValue, type SearchParams } from '../../_lib/inputs.ts';
import { pageMeta } from '../../_lib/page-meta.ts';
import { QueryFilterProvider } from '../../_lib/query-filter.tsx';
import { amountDigits, formatHour, namedIsoDay, shortIsoDay } from '../../_lib/venezuela-format.ts';
import { BreakdownCard } from './breakdown-card.tsx';
import { PaymentMix } from './payment-mix.tsx';
import { RangeFilter } from './range-filter.tsx';
import { RANGE_OPTIONS } from './ranges.ts';

export const metadata = pageMeta('Estadísticas');

/** At most this many x labels; the rest of the columns keep their tick blank. */
const MAX_TICKS = 10;

export default async function StatisticsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { companyId } = await requireCompany();
  const params = await searchParams;

  // The preset is only taken if it is one we offer — a query string is typed by
  // anyone, and an unknown span would otherwise fall through as "no preset" and
  // silently answer a different question than the URL says.
  const asked = queryValue(params, 'range') ?? '';
  const preset = RANGE_OPTIONS.find((option) => option.value === asked)?.value;

  const stats = await container().validations.validationStats({
    companyId,
    preset,
    from: queryValue(params, 'from') ?? undefined,
    to: queryValue(params, 'to') ?? undefined,
  });

  return (
    <QueryFilterProvider>
      <ContentLayout
        title="Estadísticas"
        subtitle={subtitle(stats)}
        actions={<RangeFilter range={stats.range} />}
      >
        {stats.range.clamped && (
          <Alert>
            <Icon name="info" />
            <AlertDescription>
              Un período más largo que {MAX_STATS_DAYS} días se lee por partes. Estás viendo los
              últimos {MAX_STATS_DAYS} días del rango que elegiste.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-3">
          {/* Four, not five: a fifth tile squeezes the row until the largest
              amount wraps onto a second line, and the count of payers reads
              perfectly well as this one's second number. */}
          <StatCard
            kicker="Cobrado"
            value={formatBolivares(stats.totalAmountCents)}
            note={`${stats.totalCount} ${stats.totalCount === 1 ? 'pago' : 'pagos'} · ${stats.payers} ${stats.payers === 1 ? 'pagador' : 'pagadores'}`}
          />
          <StatCard
            kicker="Ticket promedio"
            value={formatBolivares(stats.averageTicketCents)}
            note={`el mayor fue ${formatBolivares(stats.maxAmountCents)}`}
          />
          <StatCard
            kicker="Promedio por día"
            value={formatBolivares(stats.dailyAverageAmountCents)}
            note={`${stats.activeDays} de ${stats.range.days} ${stats.range.days === 1 ? 'día' : 'días'} con ventas`}
          />
          <StatCard
            kicker="Mejor día"
            value={stats.bestDay === null ? '—' : formatBolivares(stats.bestDay.amountCents)}
            note={
              stats.bestDay === null
                ? 'sin pagos en el período'
                : `${namedIsoDay(stats.bestDay.date)} · ${stats.bestDay.count} pagos`
            }
          />
        </div>

        <section className="flex flex-col gap-2">
          <h6 className="m-0 text-primary">Cobrado por día</h6>
          <Card>
            <MoneyChart
              points={dayColumns(stats.series)}
              emptyNote="No hay pagos en este período."
            />
          </Card>
        </section>

        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h6 className="m-0 text-primary">A qué hora cobras</h6>
            <span className="text-xs text-muted-foreground">
              Hora de Caracas, sumando todos los días del período
            </span>
          </div>
          <Card>
            <MoneyChart
              points={hourColumns(stats.byHour)}
              emptyNote="No hay pagos en este período."
            />
          </Card>
        </section>

        <BreakdownCard
          title="Quién cobra"
          head="Usuario"
          rows={stats.byCashier}
          noun={{ one: 'usuario', many: 'usuarios' }}
          empty="Nadie validó pagos en este período."
          totalAmountCents={stats.totalAmountCents}
        />

        <BreakdownCard
          title="De qué banco pagan"
          head="Banco emisor"
          rows={stats.bySourceBank}
          noun={{ one: 'banco', many: 'bancos' }}
          empty="No hay pagos en este período, así que no hay bancos que contar."
          totalAmountCents={stats.totalAmountCents}
        />

        <PaymentMix kinds={stats.byKind} />
      </ContentLayout>
    </QueryFilterProvider>
  );
}

/** Every plot here measures money, so every scale is spelled the same way. */
function MoneyChart({
  points,
  emptyNote,
}: {
  readonly points: readonly ColumnPoint[];
  readonly emptyNote: string;
}) {
  return (
    <ColumnChart
      points={points}
      scaleLabel={formatBolivares(peakOf(points))}
      emptyNote={emptyNote}
    />
  );
}

/** 'Últimos 7 días · 26/01 – 01/02 · 142 pagos · Bs 98.230,00'. */
function subtitle(stats: ValidationStatsView): string {
  const named = RANGE_OPTIONS.find((option) => option.value === stats.range.preset)?.label;
  const span =
    stats.range.fromDay === stats.range.toDay
      ? shortIsoDay(stats.range.toDay)
      : `${shortIsoDay(stats.range.fromDay)} – ${shortIsoDay(stats.range.toDay)}`;
  const head = named === undefined ? span : `${named} · ${span}`;

  return `${head} · ${stats.totalCount} ${stats.totalCount === 1 ? 'pago' : 'pagos'} · ${formatBolivares(stats.totalAmountCents)}`;
}

/**
 * The daily series as columns. Ticks are thinned to `MAX_TICKS` counting back
 * from the **last** day, so the most recent column is always the labelled one —
 * that is the day the reader is looking for, and dropping its label to keep an
 * even stride from the left would hide it.
 */
function dayColumns(series: readonly DayPoint[]): readonly ColumnPoint[] {
  const stride = Math.max(1, Math.ceil(series.length / MAX_TICKS));
  const last = series.length - 1;

  return series.map((point, index) => ({
    key: point.date,
    tick: (last - index) % stride === 0 ? shortIsoDay(point.date) : '',
    value: point.amountCents,
    tooltip: [
      namedIsoDay(point.date),
      `Bs ${amountDigits(point.amountCents)}`,
      `${point.count} ${point.count === 1 ? 'pago' : 'pagos'}`,
    ],
  }));
}

/** The twenty-four hours, labelled every third one so the axis stays readable. */
function hourColumns(hours: readonly HourPoint[]): readonly ColumnPoint[] {
  return hours.map((point) => ({
    key: String(point.hour),
    tick: point.hour % 3 === 0 ? String(point.hour).padStart(2, '0') : '',
    value: point.amountCents,
    tooltip: [
      formatHour(point.hour),
      `Bs ${amountDigits(point.amountCents)}`,
      `${point.count} ${point.count === 1 ? 'pago' : 'pagos'}`,
    ],
  }));
}
