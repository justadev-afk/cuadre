'use server';

/**
 * The one server call the cashier's list makes as it pages and searches.
 *
 * The screen is a client view so the tab switch is instant and the header never
 * blinks; it reaches back here for each page. Everything is scoped to the
 * signed-in cashier and their company — the id comes from the session, never the
 * client — so this cannot be aimed at another till's work.
 */
import type { Validation } from '../../../adapters/d1/validation.repository.ts';
import type { NamedRange } from '../../../application/validations/day-range.ts';
import type { PageCursor } from '../../../application/validations/list-validations.ts';
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';

export async function fetchMyValidations(input: {
  range: NamedRange;
  search: string;
  cursor: PageCursor | null;
}): Promise<{
  items: readonly Validation[];
  nextCursor: PageCursor | null;
  nowSeconds: number;
}> {
  const { session } = await requireArea('counter');
  if (session.companyId === null) {
    return { items: [], nextCursor: null, nowSeconds: 0 };
  }

  const list = await container().validations.listMyValidations({
    companyId: session.companyId,
    cashierId: session.userId,
    range: input.range,
    search: input.search.trim() || undefined,
    cursor: input.cursor ?? undefined,
  });

  return { items: list.items, nextCursor: list.nextCursor, nowSeconds: list.to };
}
