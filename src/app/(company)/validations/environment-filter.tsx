'use client';

/**
 * "Todos los entornos / Producción / Sandbox" — three options, folded into the
 * dropdown they deserve.
 *
 * They were a strip of three tabs sitting between the screen's title and its
 * search box, which is a lot of furniture for a switch most merchants never
 * touch: a shop connects one production bank and never sees a sandbox row
 * again. Meanwhile the free-text search — the control somebody actually reaches
 * for, to find a reference off a receipt — was the smallest thing in the header.
 * The tabs collapse to one closed control and the search box takes the room.
 *
 * Not searchable: three named options are read at a glance, and a filter box
 * over them would be a second text field beside the one this change exists to
 * make prominent. Everything else is the picker the merchant already uses for
 * the cashier beside it and the counter uses for a bank (§11).
 */
import { SearchableSelect, type SelectOption } from '../../_components/searchable-select.tsx';
import { useQueryFilter } from '../../_lib/query-filter.tsx';

/** The URL's spelling of each option. `all` is the absence of the parameter. */
export type EnvFilter = 'all' | 'production' | 'sandbox';

const OPTIONS: readonly SelectOption[] = [
  { value: 'all', label: 'Todos los entornos' },
  { value: 'production', label: 'Producción' },
  { value: 'sandbox', label: 'Sandbox' },
];

export function EnvironmentFilter({ value }: { value: EnvFilter }) {
  const { set, pending } = useQueryFilter();

  return (
    <div className="w-[175px]">
      <SearchableSelect
        id="validations-environment"
        options={OPTIONS}
        value={value}
        onChange={(next) => set('environment', next === 'all' ? null : next)}
        disabled={pending}
        searchable={false}
      />
    </div>
  );
}
