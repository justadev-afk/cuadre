/**
 * `POST /api/my-validations` — one page of the cashier's own list.
 *
 * The screen is a client view so the tab switch is instant and the header never
 * blinks; it reaches back here for each page. Everything is scoped to the
 * signed-in cashier and their company — both ids come from the session, never
 * from the body — so this cannot be aimed at another till's work.
 *
 * A POST rather than a GET for one reason: the cursor is a structured value the
 * list hands back, and round-tripping it through a query string would mean
 * inventing an encoding for it on both sides.
 */
import { z } from 'zod';

import { jsonResponse, requireApi } from '../../_lib/api-guard.ts';
import { container } from '../../_lib/current-session.ts';

/** The named ranges the list offers, and the opaque cursor it answers with. */
const Page = z.object({
  range: z.enum(['today', 'yesterday', 'last_7_days']),
  search: z.string().max(80).default(''),
  cursor: z
    .object({ createdAt: z.number().int(), id: z.string().min(1) })
    .nullish()
    .transform((value) => value ?? null),
});

export async function POST(request: Request): Promise<Response> {
  const guard = await requireApi('counter');
  if (!guard.ok) return guard.response;

  const { session } = guard.resolved;
  const asked = Page.safeParse(await request.json().catch(() => null));
  if (!asked.success || session.companyId === null) {
    return jsonResponse({ items: [], nextCursor: null, nowSeconds: 0 });
  }

  const list = await container().validations.listMyValidations({
    companyId: session.companyId,
    cashierId: session.userId,
    range: asked.data.range,
    search: asked.data.search.trim() || undefined,
    cursor: asked.data.cursor ?? undefined,
  });

  return jsonResponse({ items: list.items, nextCursor: list.nextCursor, nowSeconds: list.to });
}
