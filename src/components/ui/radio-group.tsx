'use client';

import * as RadioGroupPrimitive from '@radix-ui/react-radio-group';
import type * as React from 'react';

import { cn } from '@/lib/utils';

function RadioGroup({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return (
    <RadioGroupPrimitive.Root
      data-slot="radio-group"
      className={cn('grid gap-2', className)}
      {...props}
    />
  );
}

function RadioGroupItem({
  className,
  ...props
}: React.ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      data-slot="radio-group-item"
      className={cn(
        'aspect-square size-4 shrink-0 cursor-pointer rounded-full border-[1.5px] border-input transition-colors hover:border-primary',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:shadow-[inset_0_0_0_4px_var(--background)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export { RadioGroup, RadioGroupItem };
