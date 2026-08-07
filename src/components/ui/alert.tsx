import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * An inline note under a form — a refused sign-in, a sent reset link. Nocturne
 * has no red in its ramps: the surface is the same tinted block either way and
 * the leading icon carries the difference. `destructive` is the one exception,
 * for a hard error the danger token owns.
 */
const alertVariants = cva(
  'relative flex w-full items-start gap-2 rounded-md px-3 py-2 text-[13px] ring-1 ring-inset [&>i]:mt-0.5 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary/10 text-foreground ring-primary/35 [&>i]:text-primary [&>svg]:text-primary',
        destructive:
          'bg-destructive/10 text-foreground ring-destructive/45 [&>i]:text-destructive [&>svg]:text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  );
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('min-w-0 flex-1 leading-snug', className)}
      {...props}
    />
  );
}

export { Alert, AlertDescription, alertVariants };
