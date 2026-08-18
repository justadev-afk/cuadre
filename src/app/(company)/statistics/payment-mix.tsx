/**
 * Pago móvil against transferencia — one bar, two segments, and a legend that
 * carries every number.
 *
 * Two categories and a whole to divide is a **stacked bar**, and at two
 * categories it is one bar rather than a chart. What it must not be is a pie:
 * a two-slice pie asks the reader to compare angles for a comparison a length
 * answers exactly.
 *
 * The two segments are two steps of the one accent ramp, not two hues. Nocturne
 * has one hue family, and this is the honest reading of that: the pair is an
 * *ordinal* ramp — monotone lightness, a visible step between them, the light
 * end still clear of the surface — which is a validated palette, where two
 * invented hues would not be. A 2px gap in the surface colour separates them,
 * and neither segment is labelled inside itself: a small share has no room, and
 * a label that fits on one segment but not the other is worse than a legend that
 * fits both.
 */
import { Card } from '@/components/ui/card.tsx';
import type { PaymentKind } from '../../../application/ports/bank-gateway.ts';
import type { KindTotal } from '../../../application/validations/validation-stats.ts';
import { formatBolivares } from '../../../domain/money.ts';

const KIND_LABEL: Record<PaymentKind, string> = {
  pago_movil: 'Pago móvil',
  transferencia: 'Transferencia',
};

/** The ordinal pair: light step first, so the ramp reads in the bar's own order. */
const KIND_FILL: Record<PaymentKind, string> = {
  pago_movil: 'var(--color-accent-400)',
  transferencia: 'var(--color-accent-700)',
};

export function PaymentMix({ kinds }: { readonly kinds: readonly KindTotal[] }) {
  const total = kinds.reduce((sum, kind) => sum + kind.amountCents, 0);

  return (
    <section className="flex flex-col gap-2">
      <h6 className="m-0 text-primary">Cómo pagan</h6>
      <Card className="flex flex-col gap-3.5">
        {total === 0 ? (
          <p className="m-0 py-3 text-center text-sm text-muted-foreground">
            No hay pagos en este período, así que no hay mezcla que mostrar.
          </p>
        ) : (
          <>
            <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
              {kinds
                .filter((kind) => kind.amountCents > 0)
                .map((kind) => (
                  <span
                    key={kind.kind}
                    className="h-full first:rounded-l-full last:rounded-r-full"
                    style={{
                      width: `${(kind.amountCents / total) * 100}%`,
                      background: KIND_FILL[kind.kind],
                    }}
                  />
                ))}
            </div>

            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {kinds.map((kind) => (
                <li key={kind.kind} className="flex items-center gap-2.5 text-[13px]">
                  <span
                    aria-hidden="true"
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: KIND_FILL[kind.kind] }}
                  />
                  <span className="min-w-0 flex-1 truncate">{KIND_LABEL[kind.kind]}</span>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {kind.count} {kind.count === 1 ? 'pago' : 'pagos'}
                  </span>
                  <span className="w-[112px] shrink-0 text-right font-heading tabular-nums">
                    {formatBolivares(kind.amountCents)}
                  </span>
                  <span className="w-11 shrink-0 text-right text-muted-foreground tabular-nums">
                    {((kind.amountCents / total) * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </section>
  );
}
