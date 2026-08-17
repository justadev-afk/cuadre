'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { Search } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * The command palette primitive (cmdk), the guts of the searchable dropdown:
 * a filter box over a scrollable list, diacritic-folding search, arrow/enter
 * keyboard walk. Dressed as Nocturne's `.combo` popover.
 */
function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground',
        className,
      )}
      {...props}
    />
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div
      data-slot="command-input-wrapper"
      className="flex items-center gap-2 px-2.5 py-2 text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]"
    >
      <Search className="size-4 shrink-0" />
      <CommandPrimitive.Input
        data-slot="command-input"
        // Nothing autofills a dropdown's filter box. It is an `<input>` only
        // because it has to take typing — it holds no value the browser or a
        // password manager could ever have a saved answer for, and a suggestion
        // panel over an open popover covers the list the person is reading.
        //
        // It takes all of them because each vendor reads its own: `autoComplete`
        // for the browser (Chrome ignores `off` on inputs it thinks it
        // recognises, which is why there is no `name` here for it to recognise),
        // then one attribute each for 1Password, LastPass, Bitwarden and
        // Dashlane. The mobile keyboard's corrections go too — this is a filter
        // over names and codes, and autocapitalising "banesco" helps nobody.
        //
        // They sit before the spread on purpose: a caller that genuinely wants
        // autofill in some future box can still say so.
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        data-1p-ignore=""
        data-lpignore="true"
        data-bwignore=""
        data-form-type="other"
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('max-h-[240px] scroll-py-1 overflow-x-hidden overflow-y-auto p-1', className)}
      {...props}
    />
  );
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-3.5 text-center text-xs text-muted-foreground"
      {...props}
    />
  );
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn('overflow-hidden text-foreground', className)}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-2 text-[13px] outline-none select-none',
        'data-[selected=true]:bg-[color-mix(in_srgb,var(--color-text)_8%,transparent)]',
        'data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50',
        '[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn('-mx-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
};
