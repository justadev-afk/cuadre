/**
 * What a column chart is drawn from, and the one number both sides derive from
 * it.
 *
 * A plain module rather than part of `column-chart.tsx`, for the same reason
 * `statistics/ranges.ts` is not part of its filter: that file is `'use client'`,
 * and a *function* exported out of a client module is a client reference on the
 * server — calling it there throws. The scale's top is needed on both sides (the
 * server spells it, the chart draws against it), so it lives here where both can
 * genuinely have it.
 */

export type ColumnPoint = {
  /** Stable across renders — the date or the hour, not the index. */
  readonly key: string;
  /** The x tick. Empty for a column whose neighbour carries the label. */
  readonly tick: string;
  /** What the column's height is drawn from. Never negative. */
  readonly value: number;
  /** The lines the tooltip shows, in order. The first is its heading. */
  readonly tooltip: readonly string[];
};

/** The tallest column's value: the top of the scale, and every height's divisor. */
export function peakOf(points: readonly ColumnPoint[]): number {
  return points.reduce((max, point) => Math.max(max, point.value), 0);
}
