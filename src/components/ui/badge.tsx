import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The tag — a small filled pill. Colours come from Nocturne's ramps (referenced
 * as tokens, never literals): accent, accent-2 and neutral, plus an accent
 * outline. The icon-carries-meaning idiom means these are decorative.
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 rounded-md px-2.5 py-0.5 text-[11px] font-medium tracking-[0.02em] whitespace-nowrap [&_svg]:pointer-events-none [&_svg]:size-3',
  {
    variants: {
      variant: {
        accent: 'bg-[var(--color-accent-800)] text-[var(--color-accent-100)]',
        accent2: 'bg-[var(--color-accent-2-800)] text-[var(--color-accent-2-100)]',
        neutral: 'bg-[var(--color-neutral-800)] text-[var(--color-neutral-100)]',
        outline: 'border border-primary text-primary',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'span';
  return (
    <Comp data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}

export { Badge, badgeVariants };
