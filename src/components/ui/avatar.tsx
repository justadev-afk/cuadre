'use client';

import * as AvatarPrimitive from '@radix-ui/react-avatar';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/** The circular initials disc — accent-tinted, heading font — for a person in a
 *  row, the sidebar footer or a dialog. Size and text come from the caller. */
function Avatar({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Root>) {
  return (
    <AvatarPrimitive.Root
      data-slot="avatar"
      className={cn('relative flex size-9 shrink-0 overflow-hidden rounded-full', className)}
      {...props}
    />
  );
}

function AvatarImage({ className, ...props }: React.ComponentProps<typeof AvatarPrimitive.Image>) {
  return (
    <AvatarPrimitive.Image
      data-slot="avatar-image"
      className={cn('aspect-square size-full', className)}
      {...props}
    />
  );
}

function AvatarFallback({
  className,
  ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'grid size-full place-items-center rounded-full bg-[var(--color-accent-800)] font-heading text-[var(--color-accent-100)]',
        className,
      )}
      {...props}
    />
  );
}

export { Avatar, AvatarFallback, AvatarImage };
