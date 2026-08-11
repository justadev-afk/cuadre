'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { DayPicker, type DayPickerProps } from 'react-day-picker';
import { es } from 'react-day-picker/locale';

import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The shadcn calendar (react-day-picker), dressed in Nocturne's tokens.
 *
 * Every colour, radius and spacing here is a Tailwind utility or a `--color-*`
 * token, so the picker follows the theme rather than carrying a palette of its
 * own (§10). Its chevrons come from `lucide-react`, which is the rule for the
 * primitives in this folder — Phosphor is for app content.
 *
 * Spanish and Caracas time are the defaults rather than a caller's job: this
 * calendar exists for one field (the date of a pago móvil at a Venezuelan
 * counter), and "today" has to mean the cashier's today, not UTC's. A caller can
 * still override either.
 */
function Calendar({ className, classNames, showOutsideDays = true, ...props }: DayPickerProps) {
  return (
    <DayPicker
      locale={es}
      timeZone="America/Caracas"
      showOutsideDays={showOutsideDays}
      className={cn('p-3', className)}
      classNames={{
        months: 'flex flex-col gap-4',
        month: 'flex flex-col gap-4',
        month_caption: 'flex h-9 items-center justify-center',
        caption_label: 'font-heading text-sm capitalize',
        nav: 'flex items-center gap-1 absolute inset-x-3 top-3 justify-between pointer-events-none',
        button_previous: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'pointer-events-auto size-7',
        ),
        button_next: cn(
          buttonVariants({ variant: 'ghost', size: 'icon' }),
          'pointer-events-auto size-7',
        ),
        month_grid: 'w-full border-collapse',
        weekdays: 'flex',
        weekday:
          'w-9 text-[10px] font-normal tracking-[0.06em] text-muted-foreground uppercase select-none',
        week: 'flex w-full mt-1',
        day: 'size-9 p-0 text-center',
        day_button: cn(
          'size-9 cursor-pointer rounded-md p-0 font-normal text-sm tabular-nums transition-colors',
          'hover:bg-foreground/[0.08] disabled:pointer-events-none disabled:opacity-35',
        ),
        // The selected day is the one fill in the product's outline-first
        // language: a date is a single answer, and an outline reads as "maybe".
        selected:
          '[&_button]:bg-primary [&_button]:text-primary-foreground [&_button:hover]:bg-primary',
        // Today is marked by its ring alone, and deliberately sets no colour:
        // today is *usually* also the selected day, and two utilities of equal
        // specificity are resolved by their order in the stylesheet rather than
        // in this list — which is how the 11th ended up purple-on-purple and
        // unreadable. The ring composes with the fill; a colour would fight it.
        today: '[&_button]:shadow-[inset_0_0_0_1px_var(--primary)]',
        outside: '[&_button]:text-muted-foreground/50',
        disabled: 'opacity-35',
        hidden: 'invisible',
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, ...rest }) =>
          orientation === 'left' ? (
            <ChevronLeft className="size-4" {...rest} />
          ) : (
            <ChevronRight className="size-4" {...rest} />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
