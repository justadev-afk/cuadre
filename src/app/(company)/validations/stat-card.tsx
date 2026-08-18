/**
 * One of the three numbers over the list — today's takings, the average ticket,
 * the count.
 *
 * Shared by the screen and its loading state so the boxes are the same box: the
 * value and the note carry `data-sk`, which is what lets either a route
 * skeleton or a filter's `SkeletonMask` blink them in place. The kicker never
 * blinks — a label is not data, and there is nothing to wait for in it.
 */
import type { ReactNode } from 'react';

export function StatCard({
  kicker,
  value,
  note,
}: {
  kicker: string;
  value: ReactNode;
  note: ReactNode;
}) {
  return (
    <div className="flex min-w-[180px] flex-1 flex-col gap-0.5 rounded-md bg-card p-3 shadow-[var(--shadow-sm)]">
      <div className="text-[10px] tracking-[0.1em] text-primary uppercase">{kicker}</div>
      <div data-sk="line" className="font-heading text-2xl [--sk-h:16px] [--sk-w:72%]">
        {value}
      </div>
      <span data-sk="line" className="text-xs text-muted-foreground [--sk-w:56%]">
        {note}
      </span>
    </div>
  );
}
