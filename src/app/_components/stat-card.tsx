/**
 * One of the numbers over a list or a chart — today's takings, the average
 * ticket, the count, the strongest day. The panel's three and the statistics
 * screen's five are the same box (§11), so they cannot drift apart.
 *
 * `skeleton` is the same box waiting for its number: the same padding, the same
 * label, the same two lines of type, with a bar drawn over each. It is the same
 * component and not a lookalike so the boxes cannot drift apart, and the
 * placeholder text stays in the DOM under the bar (`.sk-mask`) so the line keeps
 * its own metrics and nothing resizes when the number arrives. The kicker never
 * blinks — a label is not data, and there is nothing to wait for in it.
 */
import type { ReactNode } from 'react';

export function StatCard({
  kicker,
  value,
  note,
  skeleton = false,
}: {
  kicker: string;
  value?: ReactNode;
  note?: ReactNode;
  skeleton?: boolean;
}) {
  return (
    <div
      className={`flex min-w-[180px] flex-1 flex-col gap-0.5 rounded-md bg-card p-3 shadow-[var(--shadow-sm)]${
        skeleton ? ' sk-mask' : ''
      }`}
    >
      <div className="text-[10px] tracking-[0.1em] text-primary uppercase">{kicker}</div>
      <div data-sk="line" className="font-heading text-2xl [--sk-h:16px] [--sk-w:72%]">
        {skeleton ? 'Bs 0,00' : value}
      </div>
      <span data-sk="line" className="text-xs text-muted-foreground [--sk-w:56%]">
        {skeleton ? '0 pagos aprobados' : note}
      </span>
    </div>
  );
}
