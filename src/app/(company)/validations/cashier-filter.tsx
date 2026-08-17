'use client';

/**
 * "Cajero: todos / María R." — the one control on this screen that needs a
 * script.
 *
 * The environment tabs are links and the search is a plain form, so both work
 * without JS; a picker cannot be either without a submit button beside it, and a
 * shop with eight tills wants to *find* a name rather than scan a row of tabs.
 * So it is the same `SearchableSelect` the counter uses to pick a bank — a
 * merchant should not learn a second widget for the same gesture (§11).
 *
 * It navigates rather than filtering in the browser: the list is server-rendered
 * and paged in SQL, and the URL is what makes a filtered view shareable and
 * survive a reload. Every other parameter on the URL is preserved, so choosing a
 * cashier does not silently drop the sandbox toggle or the search term.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { SearchableSelect, type SelectOption } from '../../_components/searchable-select.tsx';

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
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

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
    const query = new URLSearchParams(params.toString());
    if (next === EVERYONE) query.delete('cashier');
    else query.set('cashier', next);

    const search = query.toString();
    startTransition(() => router.push(search === '' ? pathname : `${pathname}?${search}`));
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
