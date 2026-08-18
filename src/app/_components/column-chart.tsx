'use client';

/**
 * One series over one axis: the day-by-day takings, and the hour-by-hour ones.
 *
 * Nocturne has one hue family and no categorical palette, which is not a
 * shortage here — every chart on this screen plots a *single* series, and a
 * single series takes one hue and no legend at all. What the reader has to do
 * is compare magnitudes, and the thing that makes that easy is not colour: it
 * is a common baseline, thin marks with air between them, and a scale they can
 * see.
 *
 * So the specs are fixed and small:
 *
 *  - Columns cap at 24px and never fill their slot — the leftover is air. The
 *    cap is what keeps a seven-day chart from drawing seven slabs.
 *  - A 4px rounded top, square at the baseline. The rounding marks the *data*
 *    end; rounding the other end would lift the mark off the zero it is measured
 *    from.
 *  - A day with nothing on it is a 2px stub in the de-emphasis grey, never a
 *    missing column. "We took nothing on Sunday" is information; a gap is not.
 *  - Two hairlines and nothing else: the baseline, and the top of the scale with
 *    its value beside it. No grid, no second axis, ever.
 *
 * The scale's top arrives **already spelled** (`scaleLabel`) rather than as a
 * formatter. A function cannot cross the RSC boundary into a client component,
 * and the alternative — importing `formatBolivares` in here — would decide that
 * this chart is about money, which is one decision more than a chart of columns
 * should be making.
 *
 * Every column is a `button`, which is the whole accessibility story in one
 * decision: it takes focus, so the figures reach a keyboard the same way they
 * reach a pointer, and its `aria-label` is the tooltip read aloud. The tooltip
 * itself is positioned over the plot and clamped to the ends, so the first and
 * last column's numbers are not half off the card.
 */
import { useState } from 'react';

import { cn } from '@/lib/utils.ts';
import { type ColumnPoint, peakOf } from './column-points.ts';

export function ColumnChart({
  points,
  /** The top of the scale, spelled the way the merchant reads it. */
  scaleLabel,
  /** Written across the empty plot when every column is a zero. */
  emptyNote,
  /** The plot's height in pixels. The ticks and the scale sit outside it. */
  height = 168,
  className,
}: {
  readonly points: readonly ColumnPoint[];
  readonly scaleLabel: string;
  readonly emptyNote?: string;
  readonly height?: number;
  readonly className?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);

  const peak = peakOf(points);
  const showing = hovered === null ? null : points[hovered];

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {/* The top of the scale, on its own hairline. Two lines carry the whole
          axis: this one and the baseline the columns stand on. */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground tabular-nums">{scaleLabel}</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <div className="relative">
        {showing !== undefined && showing !== null && (
          <div
            className="pointer-events-none absolute bottom-full z-10 mb-1 -translate-x-1/2 rounded-md bg-popover px-2.5 py-1.5 shadow-[var(--shadow-md)]"
            style={{ left: `${clamp(((hovered ?? 0) + 0.5) / points.length)}%` }}
          >
            <div className="font-heading text-xs whitespace-nowrap">{showing.tooltip[0]}</div>
            {showing.tooltip.slice(1).map((line) => (
              <div key={line} className="text-[11px] whitespace-nowrap text-muted-foreground">
                {line}
              </div>
            ))}
          </div>
        )}

        {/* A period with nothing in it keeps its axis — the same reason an
            emptied table keeps its columns (§10) — and says why it is flat,
            rather than leaving the reader to wonder whether it failed to load. */}
        {peak === 0 && emptyNote !== undefined && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            {emptyNote}
          </span>
        )}

        <div className="flex items-end gap-[2px]" style={{ height }}>
          {points.map((point, index) => (
            <button
              key={point.key}
              type="button"
              aria-label={point.tooltip.join(' · ')}
              onMouseEnter={() => setHovered(index)}
              onMouseLeave={() => setHovered((at) => (at === index ? null : at))}
              onFocus={() => setHovered(index)}
              onBlur={() => setHovered((at) => (at === index ? null : at))}
              className="group flex h-full min-w-0 flex-1 cursor-default items-end rounded-sm bg-transparent p-0 focus-visible:outline-none"
            >
              <span
                className={cn(
                  'mx-auto block w-full max-w-[24px] rounded-t-[4px] transition-colors',
                  point.value === 0
                    ? 'bg-[var(--color-neutral-800)]'
                    : 'bg-[var(--color-accent-500)] group-hover:bg-[var(--color-accent-400)] group-focus-visible:bg-[var(--color-accent-400)]',
                )}
                style={{
                  height: point.value === 0 ? 2 : `${Math.max(2, (point.value / peak) * 100)}%`,
                }}
              />
            </button>
          ))}
        </div>

        <div className="h-px w-full bg-border" />
      </div>

      {/* The ticks are thinned by the caller, so a label is centred on its
          column with empty neighbours either side. It is allowed to spill into
          them — clipping it to one 14px slot is how "22/07" becomes "22/…". */}
      <div className="flex gap-[2px] overflow-visible">
        {points.map((point) => (
          <span
            key={point.key}
            className="min-w-0 flex-1 overflow-visible text-center text-[10px] whitespace-nowrap text-muted-foreground tabular-nums"
          >
            {point.tick}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Keeps a tooltip's centre off the two ends, where it would hang off the card. */
function clamp(fraction: number): number {
  return Math.min(90, Math.max(10, fraction * 100));
}
