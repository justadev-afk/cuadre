'use client';

/**
 * "Change one filter, keep the rest" — the whole of what a filter control on a
 * server-rendered list has to do — and *one* transition shared by all of them.
 *
 * These lists are paged in SQL and rendered on the server, so a filter is a
 * navigation, not client state: the URL is what makes a narrowed view survive a
 * reload and be worth sending to somebody. What that costs is the bookkeeping —
 * read the current query, set one parameter, *drop* it when it means
 * "everything" (`?environment=all` is a URL that says nothing), and leave every
 * other parameter exactly as it was. A control that forgets the last part
 * silently throws away the search term beside it, which is the bug this exists
 * to have only once (§11).
 *
 * The transition is the provider's rather than each control's so that the
 * pickers share one: a control disables itself while *any* of them is being
 * answered, instead of letting a second click race the first. What the table
 * does while it waits is not their business — the page hangs it behind a
 * `Suspense` keyed by the filter, and the components draw their own `skeleton`.
 *
 * A search box asks with `replace: true`: typing is not history. Six keystrokes
 * must not be six entries the back button walks out through.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useTransition,
} from 'react';

type QueryFilter = {
  /** `null` removes the parameter — that is what "todos" is on the URL. */
  readonly set: (
    param: string,
    value: string | null,
    options?: { readonly replace?: boolean },
  ) => void;
  readonly pending: boolean;
};

const QueryFilterContext = createContext<QueryFilter | null>(null);

export function QueryFilterProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = useCallback(
    (param: string, value: string | null, options?: { readonly replace?: boolean }): void => {
      const query = new URLSearchParams(params.toString());
      if (value === null) query.delete(param);
      else query.set(param, value);

      const search = query.toString();
      const url = search === '' ? pathname : `${pathname}?${search}`;
      startTransition(() => {
        if (options?.replace === true) router.replace(url);
        else router.push(url);
      });
    },
    [params, pathname, router],
  );

  const value = useMemo<QueryFilter>(() => ({ set, pending }), [set, pending]);

  return <QueryFilterContext.Provider value={value}>{children}</QueryFilterContext.Provider>;
}

export function useQueryFilter(): QueryFilter {
  const filter = useContext(QueryFilterContext);
  if (filter === null) {
    throw new Error('useQueryFilter must be used inside a <QueryFilterProvider>');
  }
  return filter;
}
