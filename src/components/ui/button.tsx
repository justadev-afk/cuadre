import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The button, in Nocturne's clothes: the default is an accent *outline*, never
 * a fill — the product's signature. `secondary` is a neutral hairline, `ghost`
 * a bare accent, `destructive` the one danger token. Focus is left to the
 * global `:focus-visible` accent ring, so no variant fights it.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-heading text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_i]:leading-none aria-invalid:border-destructive',
  {
    variants: {
      variant: {
        default: 'border border-primary text-primary hover:bg-primary/12 active:bg-primary/20',
        secondary:
          'border border-border text-foreground hover:bg-foreground/[0.07] active:bg-foreground/[0.14]',
        outline: 'border border-border text-foreground hover:bg-foreground/[0.07]',
        ghost: 'text-primary hover:bg-primary/10 active:bg-primary/18',
        destructive: 'border border-destructive/70 text-destructive hover:bg-destructive/10',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-3.5 py-2',
        sm: 'h-8 gap-1 px-3 text-[13px]',
        lg: 'h-11 px-6 text-base',
        block: 'h-10 w-full px-4',
        icon: 'size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
