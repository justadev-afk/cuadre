import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * A loading placeholder. Height and width come from the caller — the point is
 * that it stands in for the real content it precedes. The blink is Nocturne's
 * `sk` keyframe (a fast 0.85s opacity pulse), not Tailwind's slower default, so
 * a page does not appear to load top-to-bottom.
 */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        'rounded-sm bg-[var(--color-neutral-800)] [animation:sk_0.85s_ease-in-out_infinite]',
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
