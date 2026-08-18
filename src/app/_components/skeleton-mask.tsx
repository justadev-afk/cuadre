'use client';

/**
 * The region a filter is re-querying, while it waits.
 *
 * A route skeleton is the wrong shape for this: the answer is already on
 * screen, and replacing the whole page with placeholders of *another* layout
 * makes the header, the pickers and the search box blink out and come back a
 * few pixels away — on the one screen where somebody is typing. So the rows and
 * the totals stay exactly where they are, in the DOM, at their exact size, and
 * only their ink is swapped for a bar (`.sk-mask` in `globals.css`). Nothing
 * moves, nothing is clickable mid-query, and when the server answers the bars
 * fill in where they stood.
 *
 * It renders the element it is given a `className` for rather than wrapping one
 * — a mask that adds a `<div>` to a flex column adds a gap nobody asked for.
 */
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils.ts';
import { useQueryFilter } from '../_lib/query-filter.tsx';

export function SkeletonMask({ className, children }: { className?: string; children: ReactNode }) {
  const { pending } = useQueryFilter();

  return (
    <div className={cn(className, pending && 'sk-mask')} aria-busy={pending || undefined}>
      {children}
    </div>
  );
}
