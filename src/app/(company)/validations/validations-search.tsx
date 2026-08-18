'use client';

/**
 * The search box — the control somebody standing here with a receipt in their
 * hand actually reaches for.
 *
 * It used to sit in the header, at 280px, and only answered the Enter key: a
 * field with no button that does nothing when you type in it reads as broken.
 * So it is a full-width row of its own between the day's totals and the table
 * it filters — the two things it is *about* — and it searches by itself 200ms
 * after the last keystroke. The button stays, because a search field without
 * one is a field somebody presses Enter on to be sure; it commits the same term
 * the timer would, immediately.
 *
 * 200ms is short enough that the list feels like it is following the typing and
 * long enough that "12346090431" is one query rather than eleven. Nothing here
 * disables itself while the server answers — the table masks its own rows
 * (`SkeletonMask`) and the field keeps the cursor, mid-word, right where it was.
 *
 * The term travels in the URL like every other filter, but with `replace`:
 * typing is not history, and eleven keystrokes must not be eleven entries the
 * back button walks out through.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Icon } from '../../_components/icon.tsx';
import { useQueryFilter } from '../../_lib/query-filter.tsx';

const DEBOUNCE_MS = 200;

export function ValidationsSearch({
  /** The term on the URL right now — the server rendered the list with it. */
  value,
  placeholder = 'Buscar por referencia, código, monto o cajero…',
}: {
  value: string;
  placeholder?: string;
}) {
  const { set } = useQueryFilter();
  const [text, setText] = useState(value);
  /** The last term we asked the server for, so a no-op never navigates. */
  const asked = useRef(value);

  // The URL is still the source of truth: back, forward, or a link into a
  // filtered view writes the field. Only when it says something we did not ask
  // for — otherwise our own navigation would fight what is being typed.
  useEffect(() => {
    if (value === asked.current) return;
    asked.current = value;
    setText(value);
  }, [value]);

  const commit = useCallback(
    (next: string): void => {
      const term = next.trim();
      if (term === asked.current) return;
      asked.current = term;
      set('q', term === '' ? null : term, { replace: true });
    },
    [set],
  );

  useEffect(() => {
    const timer = setTimeout(() => commit(text), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, commit]);

  const clear = (): void => {
    setText('');
    commit('');
  };

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        commit(text);
      }}
    >
      <div className="relative min-w-0 flex-1">
        <Icon
          name="magnifying-glass"
          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          name="q"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={placeholder}
          aria-label="Buscar validaciones"
          autoComplete="off"
          className="pr-9 pl-9"
        />
        {text !== '' && (
          <button
            type="button"
            onClick={clear}
            aria-label="Limpiar la búsqueda"
            className="absolute top-1/2 right-1.5 grid size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <Icon name="x" />
          </button>
        )}
      </div>
      <Button type="submit" variant="secondary">
        <Icon name="magnifying-glass" />
        Buscar
      </Button>
    </form>
  );
}
