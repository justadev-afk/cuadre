'use client';

/**
 * "Cajero: todos / María R."
 *
 * A shop with eight tills wants to *find* a name rather than scan a row of
 * tabs, so it is the same `SearchableSelect` the counter picks a bank with — a
 * merchant should not learn a second widget for the same gesture (§11), which
 * is also why the environment beside it is now that same control.
 *
 * It navigates rather than filtering in the browser (`useQueryFilter`): the list
 * is server-rendered and paged in SQL, and the URL is what makes a filtered view
 * shareable and survive a reload.
 */
import { SearchableSelect, type SelectOption } from '../../_components/searchable-select.tsx';
import { useQueryFilter } from '../../_lib/query-filter.tsx';

/** The value that means "everybody". Absent from the URL, never `?cashier=all`. */
const EVERYONE = '';

export function CashierFilter({
  cashiers,
  value,
}: {
  /** The company's people, in the order `listEmployees` returns them. */
  cashiers: readonly { readonly id: string; readonly name: string; readonly role: string }[];
  /** The id on the URL right now, or '' for everybody. */
  value: string;
}) {
  const { set, pending } = useQueryFilter();

  const options: readonly SelectOption[] = [
    { value: EVERYONE, label: 'Todos los usuarios' },
    ...cashiers.map((person) => ({
      value: person.id,
      label: person.name,
      // Which of the two they are, in the same dim slot the bank picker uses for
      // a Sudeban code — a shop's owner also validates at the counter.
      hint: person.role === 'cashier' ? 'Cajero' : 'Empresa',
    })),
  ];

  const choose = (next: string): void => {
    set('cashier', next === EVERYONE ? null : next);
  };

  return (
    <div className="w-[190px]">
      <SearchableSelect
        id="validations-cashier"
        options={options}
        value={value}
        onChange={choose}
        disabled={pending}
        placeholder="Todos los usuarios"
        searchPlaceholder="Buscar usuario…"
      />
    </div>
  );
}
