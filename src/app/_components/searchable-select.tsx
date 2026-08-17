'use client';

/**
 * A searchable dropdown — a trigger that reads like an `Input`, opening a
 * popover with a filter box and a scrollable list. Used for the bank emisor at
 * the counter, where a plain `<select>` of every Venezuelan bank is a scroll,
 * not a choice. Built on Radix Popover + cmdk (Command): the caller owns the
 * value; remembering the last pick (localStorage) lives with the caller too, so
 * this stays a pure controlled input.
 */
import { Check } from 'lucide-react';
import { useState } from 'react';

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover.tsx';
import { cn } from '@/lib/utils.ts';
import { Icon } from './icon.tsx';

export type SelectOption = {
  readonly value: string;
  readonly label: string;
  /** A dim leading tag — the Sudeban code, for the bank list. */
  readonly hint?: string;
};

type SearchableSelectProps = {
  id?: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  /**
   * Off for a short, fixed list. Three named options are read at a glance, and
   * a filter box over them is a text field that does nothing — worse where the
   * screen's actual search field is standing right beside it. Everything else
   * stays: same trigger, same popover, same rows, same gesture (§11).
   */
  searchable?: boolean;
};

/** Diacritic- and case-insensitive, so "merida" finds "Mérida". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function SearchableSelect({
  id,
  options,
  value,
  onChange,
  placeholder = 'Elige una opción',
  searchPlaceholder = 'Buscar…',
  disabled = false,
  searchable = true,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-expanded={open}
          className="flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:border-foreground/45 disabled:cursor-default disabled:opacity-55 data-[state=open]:border-primary"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground/70')}>
            {selected ? selected.label : placeholder}
          </span>
          <Icon name="caret-down" className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
        <Command
          // Diacritic-folding contains, over the label and the Sudeban code.
          filter={(itemValue, search) => (fold(itemValue).includes(fold(search)) ? 1 : 0)}
        >
          {searchable && <CommandInput placeholder={searchPlaceholder} />}
          <CommandList>
            {searchable && <CommandEmpty>Sin resultados</CommandEmpty>}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.hint ?? ''}`}
                  onSelect={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  aria-selected={option.value === value}
                  className={cn(option.value === value && 'text-primary')}
                >
                  {option.hint ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {option.hint}
                    </span>
                  ) : null}
                  <span className="flex-1 truncate">{option.label}</span>
                  {option.value === value ? <Check className="ml-auto size-4 shrink-0" /> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
