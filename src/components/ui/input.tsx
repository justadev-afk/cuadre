import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The text field. Surface fill, divider hairline, accent caret and focus
 * border — the Nocturne `.input`, one class deep. `aria-invalid` turns the
 * border to the danger token, which is how live validation flags a field.
 */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'flex h-9 w-full min-w-0 rounded-md border border-input bg-card px-2.5 py-1.5 text-sm text-foreground caret-primary transition-colors',
        'placeholder:text-muted-foreground/70 hover:border-foreground/45 focus-visible:border-primary',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'aria-invalid:border-destructive aria-invalid:hover:border-destructive aria-invalid:focus-visible:border-destructive',
        'file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
