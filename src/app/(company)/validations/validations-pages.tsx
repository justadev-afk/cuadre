'use client';

/**
 * The panel's list, fifty rows at a time, with the next two pages already in
 * the browser by the time the merchant reaches for *Siguiente*.
 *
 * **Page one is the server's.** It arrives rendered with the screen, under the
 * same `Suspense` the filters key, so nothing here delays the first paint and a
 * merchant who never pages never costs a second request. Pages two and beyond
 * are `POST /api/validations`, kept in a small cache beside their keyset start
 * cursors — turning a page is then a state change, not a navigation, so the
 * header, the pickers and the half-typed search box above the table stay
 * exactly where they are.
 *
 * **The prefetch is two pages deep and strictly sequential.** It has to be: page
 * three cannot be asked for until page two has come back and said where it ends,
 * which is what a keyset cursor is. Two is the depth that makes paging feel
 * free without turning an idle panel into a crawler — a merchant clicking
 * through is always one cached page ahead of themselves, and the page behind
 * that is fetching while they read.
 *
 * **A filter is not this component's business.** Environment, cashier and search
 * live on the URL and are answered by the server; when one changes, the page
 * re-renders and this whole view is remounted by its key, back at page one with
 * an empty cache. That is exactly right — a page-three position under a filter
 * that no longer applies is a position in a different list. It is also what
 * makes an in-flight page safe to keep: it can only belong to the filters this
 * instance was mounted with.
 *
 * **New rows reset it; a refresh that found none does not.** The screen re-asks
 * the server every thirty seconds, and almost every one of those answers is the
 * same list it already had. So what this watches is not *that* the page
 * re-rendered but whether page one actually moved — its first row, its length,
 * where it ends. Unchanged means nothing was inserted above the cursors, which
 * means every cached page below is still exactly right, and a quiet panel left
 * open all afternoon costs nothing beyond the refresh itself. Changed, and the
 * cache goes: at page one on the spot, deeper in remembered and applied when the
 * merchant comes back — a list that reshuffled itself while somebody was reading
 * page three would be worse than one a minute old.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import type { Validation } from '../../../adapters/d1/validation.repository.ts';
import type { PageCursor } from '../../../application/validations/list-validations.ts';
import { Icon } from '../../_components/icon.tsx';
import { Pager } from '../../_components/pager.tsx';
import { ValidationList } from '../../_components/validation-list.tsx';
import { API } from '../../_lib/endpoints.ts';
import { postJson } from '../../_lib/use-endpoint-action.ts';
import type { EnvFilter } from './environment-filter.tsx';

/** What `/api/validations` answers with — one page and the clock it read. */
type Page = {
  readonly items: readonly Validation[];
  readonly nextCursor: PageCursor | null;
  readonly nowSeconds: number;
};

/** Pages kept ahead of the one being read. See the note at the top of the file. */
const PREFETCH_AHEAD = 2;

export function ValidationsPages({
  initialItems,
  initialNextCursor,
  initialNowSeconds,
  environment,
  cashierId,
  search,
  merchantName,
  merchantRif,
  emptyMessage,
}: {
  readonly initialItems: readonly Validation[];
  readonly initialNextCursor: PageCursor | null;
  readonly initialNowSeconds: number;
  /** The three filters, exactly as the server read them off the URL. */
  readonly environment: EnvFilter;
  readonly cashierId: string;
  readonly search: string;
  readonly merchantName?: string;
  readonly merchantRif?: string;
  /** What the empty card says — it names the filter that emptied the list. */
  readonly emptyMessage: string;
}) {
  const first: Page = {
    items: initialItems,
    nextCursor: initialNextCursor,
    nowSeconds: initialNowSeconds,
  };

  const [index, setIndex] = useState(0);
  /** Pages 2 and beyond, by their zero-based index. Page 1 is always `first`. */
  const [ahead, setAhead] = useState<Record<number, Page>>({});
  /**
   * Where each page begins: `starts[n]` is the cursor page `n − 1` ended on.
   * Page two's start is not in here — it is page one's `nextCursor`, which
   * arrives with every server render, so reading it off the props is what keeps
   * the chain correct across a refresh instead of pinned to a stale position.
   *
   * Held apart from the pages themselves so that dropping the cache does not
   * also lose the merchant's place in the list.
   */
  const [starts, setStarts] = useState<Record<number, PageCursor>>({});
  /**
   * The page a request failed on. State rather than a ref because it is what
   * stops the chain retrying in a loop *and* what the screen renders instead of
   * a placeholder that would never fill — both have to happen on the same render.
   */
  const [failed, setFailed] = useState<number | null>(null);

  /** One request at a time: the chain is sequential by construction. */
  const fetching = useRef(false);
  /**
   * What page one looked like when the cache below it was built. Its first row,
   * how many rows, and the cursor it ends on — the three things that change if
   * and only if rows were inserted above the cached pages.
   */
  const signature = `${initialItems[0]?.id ?? ''}|${initialItems.length}|${initialNextCursor?.id ?? ''}`;
  const builtFrom = useRef(signature);
  const stale = useRef(false);

  const pageAt = (at: number): Page | undefined => (at === 0 ? first : ahead[at]);
  const current = pageAt(index);

  const reset = useCallback((): void => {
    setAhead({});
    setStarts({});
    setIndex(0);
    setFailed(null);
    stale.current = false;
  }, []);

  // Rows landed. At the top of the list that is simply the new page one; deeper
  // in it waits, because reshuffling a list somebody is reading is worse than
  // showing them one that is a minute old.
  useEffect(() => {
    if (builtFrom.current === signature) return;
    builtFrom.current = signature;
    if (index === 0) reset();
    else stale.current = true;
  }, [signature, index, reset]);

  // Fill the page being read, then the two behind it — one request at a time,
  // because the cursor that starts page n+1 only exists once page n has answered.
  useEffect(() => {
    if (fetching.current) return;

    const wanted = nextMissing(
      index,
      (at) => (at === 1 ? initialNextCursor : starts[at]),
      (at) => ahead[at],
    );
    if (wanted === null || wanted.at === failed) return;

    fetching.current = true;
    // Deliberately not cancelled when the deps change: this answer belongs to
    // `wanted.at` under filters that cannot change without remounting the whole
    // view, so throwing it away would only cost a second request — and would
    // leave the chain with nothing to re-trigger it.
    void postJson<Page>(API.validations, {
      environment,
      cashier: cashierId,
      search,
      cursor: wanted.cursor,
    })
      .catch(() => null)
      .then((page) => {
        fetching.current = false;
        if (page === null) {
          setFailed(wanted.at);
          return;
        }
        setAhead((held) => ({ ...held, [wanted.at]: page }));

        const after = page.nextCursor;
        // Where the page *after* this one starts, now that we know.
        if (after !== null) setStarts((held) => ({ ...held, [wanted.at + 1]: after }));
      });
  }, [index, starts, ahead, failed, initialNextCursor, environment, cashierId, search]);

  const goNext = (): void => {
    if (current?.nextCursor == null) return;
    setFailed(null);
    setIndex(index + 1);
  };

  const goPrev = (): void => {
    if (index === 0) return;
    setFailed(null);
    // Back at the top with a newer render waiting: this is the moment to take it.
    if (index - 1 === 0 && stale.current) reset();
    else setIndex(index - 1);
  };

  const broken = current === undefined && failed === index;
  const waiting = current === undefined && !broken;

  return (
    <>
      {current === undefined ? (
        <ValidationList skeleton showCashier rows={10} />
      ) : (
        <ValidationList
          items={current.items}
          nowSeconds={current.nowSeconds}
          showCashier
          merchantName={merchantName}
          merchantRif={merchantRif}
        />
      )}

      {broken && (
        <Card className="flex flex-col items-center gap-3 py-5">
          <p className="m-0 text-center text-sm text-muted-foreground">
            No pudimos cargar esta página. Puede ser la conexión.
          </p>
          <Button type="button" variant="secondary" size="sm" onClick={() => setFailed(null)}>
            <Icon name="arrows-clockwise" />
            Reintentar
          </Button>
        </Card>
      )}

      {current !== undefined && current.items.length === 0 && (
        <Card>
          <p className="m-0 py-5 text-center text-sm text-muted-foreground">
            {emptyLine(index, current.nextCursor !== null, emptyMessage)}
          </p>
        </Card>
      )}

      <Pager
        pageIndex={index}
        canPrev={index > 0}
        canNext={current?.nextCursor != null}
        onPrev={goPrev}
        onNext={goNext}
        busy={waiting}
      />
    </>
  );
}

/**
 * What an empty page says.
 *
 * Three different sentences, because "no results" is three different facts. On
 * page one with nothing after it, the filter genuinely matched nothing and the
 * caller's message names which filter did it. With a page still to come, the
 * search simply spent its scan budget without a hit — saying "ninguna coincide"
 * there would be a claim about rows nobody has looked at yet. And past page one,
 * the list has run out, which is not a surprise worth explaining.
 */
function emptyLine(index: number, hasMore: boolean, emptyMessage: string): string {
  if (hasMore)
    return 'No hay coincidencias en esta parte de la lista. Sigue en la página siguiente.';
  if (index > 0) return 'No quedan más validaciones en este filtro.';
  return emptyMessage;
}

/**
 * The next page worth asking for: the one being read if it is not here yet,
 * then the two behind it. `null` when everything wanted is already held, when
 * the list has genuinely ended, or when the cursor that would start the page is
 * not known yet — in which case the page before it is still in flight and this
 * runs again the moment it lands.
 */
function nextMissing(
  index: number,
  /** `null` ends the list, `undefined` means the page before it has not landed. */
  startOf: (at: number) => PageCursor | null | undefined,
  held: (at: number) => Page | undefined,
): { readonly at: number; readonly cursor: PageCursor } | null {
  for (let at = index; at <= index + PREFETCH_AHEAD; at++) {
    if (at === 0 || held(at) !== undefined) continue;

    const cursor = startOf(at);
    if (cursor === undefined || cursor === null) return null;
    return { at, cursor };
  }
  return null;
}
