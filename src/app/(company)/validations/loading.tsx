import { Card } from '@/components/ui/card.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { SkeletonLine } from '../../_components/skeleton.tsx';

/**
 * Screen 25 — validations entering with skeletons. Built from the *same* markup
 * as the loaded page (the three stat cards, the real `.table` with its real
 * headers) so it is 1:1: the columns land where the data will, nothing jumps.
 */
const STAT =
  'flex min-w-[180px] flex-1 flex-col gap-2 rounded-md bg-card px-[18px] py-4 shadow-[var(--shadow-sm)]';
const STAT_LABELS = ['Cobrado hoy', 'Ticket promedio', 'Pagos validados'];
const ROWS = ['a', 'b', 'c', 'd', 'e', 'f'];

export default function Loading() {
  return (
    <ContentLayout
      title="Validaciones"
      subtitle={<SkeletonLine width="230px" height={12} />}
      actions={
        <div className="h-9 w-[280px] animate-[sk_0.85s_ease-in-out_infinite] rounded-md bg-[var(--color-neutral-800)]" />
      }
    >
      <div className="flex flex-wrap gap-3">
        {STAT_LABELS.map((label) => (
          <div key={label} className={STAT}>
            <div className="text-[10px] tracking-[0.1em] text-primary uppercase">{label}</div>
            <SkeletonLine width="96px" height={22} />
            <SkeletonLine width="70px" height={11} />
          </div>
        ))}
      </div>

      <Card className="overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Control</th>
              <th>Hora</th>
              <th>Referencia</th>
              <th className="text-right">Monto (Bs)</th>
              <th>Teléfono</th>
              <th>Cajero</th>
              <th>Banco</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((k) => (
              <tr key={k}>
                <td>
                  <SkeletonLine width="58px" />
                </td>
                <td>
                  <SkeletonLine width="40px" />
                </td>
                <td>
                  <SkeletonLine width="108px" />
                </td>
                <td>
                  <div className="flex justify-end">
                    <SkeletonLine width="64px" />
                  </div>
                </td>
                <td>
                  <SkeletonLine width="100px" />
                </td>
                <td>
                  <SkeletonLine width="88px" />
                </td>
                <td>
                  <SkeletonLine width="72px" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </ContentLayout>
  );
}
