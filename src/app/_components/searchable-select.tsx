'use client';

/**
 * A searchable dropdown — a trigger that reads like an `.input`, opening a
 * popover with a filter box and a scrollable list. Used for the bank emisor at
 * the counter, where a plain `<select>` of every Venezuelan bank is a scroll,
 * not a choice. The caller owns the value; remembering the last pick (localStorage)
 * lives with the caller too, so this stays a pure controlled input.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';

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
};

/** Diacritic- and case-insensitive contains, so "merida" finds "Mérida". */
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
}: SearchableSelectProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((option) => option.value === value) ?? null;

  const filtered = useMemo(() => {
    const needle = fold(query.trim());
    if (needle === '') return options;
    return options.filter(
      (option) => fold(option.label).includes(needle) || fold(option.hint ?? '').includes(needle),
    );
  }, [options, query]);

  // Opening focuses the filter and resets the highlight to the top of the list.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    const raf = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // A click anywhere outside closes it — the popover is not a modal.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function choose(next: string): void {
    onChange(next);
    setOpen(false);
  }

  function onSearchKeyDown(event: React.KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => Math.min(current + 1, filtered.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const pick = filtered[active];
      if (pick) choose(pick.value);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div className="combo" ref={rootRef}>
      <button
        type="button"
        id={id}
        className="input combo-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={selected ? undefined : 'combo-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <Icon name="caret-down" className="combo-caret" />
      </button>

      {open && (
        <div className="combo-pop">
          <div className="combo-search">
            <Icon name="magnifying-glass" />
            <input
              ref={searchRef}
              className="combo-search-input"
              value={query}
              placeholder={searchPlaceholder}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKeyDown}
            />
          </div>
          <div className="combo-list" id={listId} role="listbox">
            {filtered.length === 0 ? (
              <div className="combo-empty">Sin resultados</div>
            ) : (
              filtered.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  className="combo-opt"
                  role="option"
                  aria-selected={option.value === value}
                  data-active={index === active ? '' : undefined}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => choose(option.value)}
                >
                  {option.hint ? <span className="combo-opt-hint">{option.hint}</span> : null}
                  <span className="combo-opt-label">{option.label}</span>
                  {option.value === value ? (
                    <Icon name="check" className="combo-opt-check" />
                  ) : null}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
