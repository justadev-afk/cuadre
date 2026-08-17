'use client';

/**
 * "Change one filter, keep the rest" — the whole of what a filter control on a
 * server-rendered list has to do.
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
 * `pending` is the transition's, so a control can disable itself while the
 * server renders rather than letting a second click race the first.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

export function useQueryFilter(): {
  /** `null` removes the parameter — that is what "todos" is on the URL. */
  readonly set: (param: string, value: string | null) => void;
  readonly pending: boolean;
} {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const set = (param: string, value: string | null): void => {
    const query = new URLSearchParams(params.toString());
    if (value === null) query.delete(param);
    else query.set(param, value);

    const search = query.toString();
    startTransition(() => router.push(search === '' ? pathname : `${pathname}?${search}`));
  };

  return { set, pending };
}
