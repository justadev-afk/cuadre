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
import { type FocusEvent, type KeyboardEvent, useRef, useState } from 'react';

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

/**
 * Everything a Tab can land on, so the popover can hand the next Tab onward to
 * the field after the trigger instead of into the portal it lives in.
 */
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The field before or after `from`, as the browser would have reached it.
 *
 * The popover is portalled to the end of `<body>`, so a plain Tab out of its
 * filter box walks off the end of the document rather than into the next field
 * of the form — which is the whole reason the dropdown is on the tab route in
 * the first place. Its own contents are skipped (it is closing), and so are
 * Radix's focus guards, which are tabbable by design and belong to nobody.
 */
function focusAdjacentField(from: HTMLElement, back: boolean): void {
  const fields = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter(
    (element) =>
      element === from ||
      (element.offsetParent !== null &&
        element.closest('[data-radix-popper-content-wrapper], [data-radix-focus-guard]') === null),
  );
  const at = fields.indexOf(from);
  if (at === -1) return;
  fields[at + (back ? -1 : 1)]?.focus();
}

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
  /**
   * The filter, held here rather than by cmdk, so a key pressed on the *closed*
   * trigger can seed it — see `typeToOpen`. Cleared on close, so the list is
   * whole again the next time it is opened.
   */
  const [search, setSearch] = useState('');
  const selected = options.find((option) => option.value === value) ?? null;

  const triggerRef = useRef<HTMLButtonElement>(null);
  /** Focus this component put back on the trigger itself, which must not re-open. */
  const returning = useRef(false);
  /** A pointer is down on the trigger: the click it becomes is what toggles. */
  const pressing = useRef(false);
  /** Where focus goes when the popover closes — Radix's answer is overridden. */
  const exit = useRef<'trigger' | 'away'>('trigger');

  /**
   * Closing on our own terms — a choice, or a Tab out. `onOpenChange` only hears
   * about the closes Radix itself decides (Escape, a click outside), so the
   * filter has to be cleared here too or the next open re-opens onto the last
   * search: one bank listed, and no sign of why.
   */
  function close(): void {
    setOpen(false);
    setSearch('');
  }

  function focusTrigger(): void {
    returning.current = true;
    triggerRef.current?.focus();
    returning.current = false;
  }

  /**
   * Focus opens it. Tabbing to a dropdown and finding it shut is a stop: the
   * next key does nothing until you have guessed that this one needs opening
   * first, and on a till that guess is made with a customer waiting. So the list
   * is already down and the caret is already in its filter — the field is asking
   * its question by the time the eye arrives.
   *
   * Two kinds of focus are *not* somebody arriving here, and both would make the
   * dropdown look broken:
   *
   *  - **A click.** The press focuses the button and the click then toggles it,
   *    so opening on the focus too is a dropdown that flickers shut when tapped.
   *  - **The focus we hand back when it closes.** Choosing an option returns the
   *    caret to the trigger; re-opening on that is a list that cannot be closed.
   *
   * `:focus-visible` already answers the first — a mouse press on a button does
   * not raise it — but the pointer flag is kept because that failure is the one
   * the whole counter would hit, and this is two lines against it.
   */
  function openOnFocus(event: FocusEvent<HTMLButtonElement>): void {
    const byPointer = pressing.current;
    pressing.current = false;
    if (returning.current || byPointer || disabled) return;
    if (!event.currentTarget.matches(':focus-visible')) return;
    setOpen(true);
  }

  /**
   * Typing on the closed trigger opens the popover with that letter already in
   * the filter — what every native `<select>` does, and what a cashier's hands
   * expect after tabbing here from the phone field. The trigger is a `<button>`,
   * and a button swallows a letter silently: without this, tab-then-type looks
   * exactly like a broken field until somebody reaches for the mouse.
   *
   * Space is left alone — it is how a button is pressed — and so is any chord,
   * which belongs to the browser.
   */
  function typeToOpen(event: KeyboardEvent<HTMLButtonElement>): void {
    if (!searchable || open) return;
    if (event.key.length !== 1 || event.key === ' ') return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    setSearch(event.key);
    setOpen(true);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setSearch('');
      }}
    >
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          id={id}
          disabled={disabled}
          aria-expanded={open}
          onPointerDown={() => {
            pressing.current = true;
          }}
          onBlur={() => {
            pressing.current = false;
          }}
          onFocus={openOnFocus}
          onKeyDown={typeToOpen}
          className="flex h-9 w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-input bg-card px-2.5 py-1.5 text-left text-sm text-foreground transition-colors hover:border-foreground/45 disabled:cursor-default disabled:opacity-55 data-[state=open]:border-primary"
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground/70')}>
            {selected ? selected.label : placeholder}
          </span>
          <Icon name="caret-down" className="shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-(--radix-popover-trigger-width) p-0"
        // Radix returns focus to the trigger on every close, which a trigger
        // that opens on focus would answer by opening again. So the answer is
        // this component's: back to the trigger after a choice or an Escape,
        // and left alone when the person is already somewhere else — they
        // clicked outside, or they tabbed on and the handler below placed it.
        onInteractOutside={() => {
          exit.current = 'away';
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (exit.current === 'trigger') focusTrigger();
          exit.current = 'trigger';
        }}
        // Tab means "next field", even from inside a popover that is portalled
        // to the end of the document. Without this it means "off the end of the
        // page", and the form is only walkable in one direction.
        onKeyDown={(event) => {
          if (event.key !== 'Tab' || triggerRef.current === null) return;
          event.preventDefault();
          exit.current = 'away';
          close();
          focusAdjacentField(triggerRef.current, event.shiftKey);
        }}
      >
        <Command
          // Diacritic-folding contains, over the label and the Sudeban code.
          filter={(itemValue, query) => (fold(itemValue).includes(fold(query)) ? 1 : 0)}
        >
          {searchable && (
            <CommandInput
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
            />
          )}
          <CommandList>
            {searchable && <CommandEmpty>Sin resultados</CommandEmpty>}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.hint ?? ''}`}
                  onSelect={() => {
                    onChange(option.value);
                    close();
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
