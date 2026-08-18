/**
 * A ranked breakdown: who, or which bank, and how much of the money.
 *
 * A table with a bar in the last column rather than a bar chart with a legend.
 * The reason is the form, not the effort — these are nominal categories a
 * merchant reads by *name* (a cashier, a bank), and the two numbers beside each
 * name are what they came for. A chart would spend the identity channel on
 * colour and then need a legend to give it back. The bar is the comparison, the
 * columns are the values, and the table *is* the accessible view.
 *
 * Every bar is the same hue for the same reason: the length carries the
 * magnitude, so colouring by rank would re-encode what the bar already says and
 * make a filter that drops one row repaint the survivors.
 *
 * The tail is folded, and says so. A shop with thirty payer banks gets the eight
 * that matter and one honest "otros 22"; a silent top-eight would read as the
 * whole list.
 */
import { Card } from '@/components/ui/card.tsx';
import type { NamedTotal } from '../../../application/validations/validation-stats.ts';
import { formatBolivares } from '../../../domain/money.ts';
import { amountDigits } from '../../_lib/venezuela-format.ts';

/** Rows shown before the tail is folded into one. */
const TOP = 8;

export function BreakdownCard({
  title,
  rows,
  /** What one row is, for the folded tail and the empty line: "banco", "cajero". */
  noun,
  /** The column head over the names. */
  head,
  /** Shown instead of the table when the range holds nothing at all. */
  empty,
  /** Total money in the range — shares are of this, not of the rows shown. */
  totalAmountCents,
}: {
  readonly title: string;
  readonly rows: readonly NamedTotal[];
  readonly noun: { readonly one: string; readonly many: string };
  readonly head: string;
  readonly empty: string;
  readonly totalAmountCents: number;
}) {
  const shown = rows.slice(0, TOP);
  const tail = rows.slice(TOP);
  const folded =
    tail.length === 0
      ? null
      : tail.reduce(
          (sum, row) => ({
            count: sum.count + row.count,
            amountCents: sum.amountCents + row.amountCents,
          }),
          { count: 0, amountCents: 0 },
        );

  // The widest bar is the top row's, so the column is read against the leader
  // rather than against a total that would squash every bar into a sliver.
  const peak = shown.reduce((max, row) => Math.max(max, row.amountCents), 0);

  return (
    <section className="flex flex-col gap-2">
      <h6 className="m-0 text-primary">{title}</h6>
      {rows.length === 0 ? (
        <Card>
          <p className="m-0 py-4 text-center text-sm text-muted-foreground">{empty}</p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>{head}</th>
                <th className="text-right">Pagos</th>
                <th className="text-right">Monto (Bs)</th>
                <th className="w-[34%]">Participación</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.key}>
                  <td className="font-heading whitespace-nowrap">{row.label ?? row.key}</td>
                  <td className="text-right tabular-nums">{row.count}</td>
                  <td className="text-right tabular-nums">{amountDigits(row.amountCents)}</td>
                  <td>
                    <Share
                      amountCents={row.amountCents}
                      peak={peak}
                      totalAmountCents={totalAmountCents}
                    />
                  </td>
                </tr>
              ))}
              {folded !== null && (
                <tr>
                  <td className="font-heading whitespace-nowrap text-muted-foreground">
                    Otros {tail.length} {tail.length === 1 ? noun.one : noun.many}
                  </td>
                  <td className="text-right tabular-nums">{folded.count}</td>
                  <td className="text-right tabular-nums">{amountDigits(folded.amountCents)}</td>
                  <td>
                    <Share
                      amountCents={folded.amountCents}
                      peak={peak}
                      totalAmountCents={totalAmountCents}
                      muted
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}

/**
 * The bar, and the share it is. The percentage is of the range's whole money —
 * the bar is drawn against the leader so the column has shape, and the number
 * beside it says what the shape means, which is the pair the bar alone cannot
 * be trusted to carry.
 */
function Share({
  amountCents,
  peak,
  totalAmountCents,
  muted = false,
}: {
  readonly amountCents: number;
  readonly peak: number;
  readonly totalAmountCents: number;
  readonly muted?: boolean;
}) {
  const share = totalAmountCents === 0 ? 0 : (amountCents / totalAmountCents) * 100;

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--color-neutral-800)]">
        <div
          className={`h-full rounded-full ${muted ? 'bg-[var(--color-neutral-600)]' : 'bg-[var(--color-accent-500)]'}`}
          style={{ width: `${peak === 0 ? 0 : Math.max(2, (amountCents / peak) * 100)}%` }}
          title={formatBolivares(amountCents)}
        />
      </div>
      <span className="w-11 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">
        {share.toFixed(1)}%
      </span>
    </div>
  );
}
