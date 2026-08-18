/**
 * `POST /api/validations` — one page of the company panel's list.
 *
 * The first page is server-rendered with the screen, so this only ever answers
 * the pages *after* it: the one the merchant clicked through to, and the two the
 * screen fetches behind it so that clicking again is instant. Which is the whole
 * reason it exists — a page turn that navigates the route would rebuild the
 * header, the filters and the search box the merchant is standing in.
 *
 * The company is the session's, never the body's: the filters travel because
 * they are the merchant's own question, and `companyId` is the one thing they
 * are not allowed to ask.
 *
 * A POST rather than a GET for the same reason `/api/my-validations` is one: the
 * cursor is a structured position the list hands back, and round-tripping it
 * through a query string would mean inventing an encoding for it on both sides.
 */
import { z } from 'zod';

import { jsonResponse, requireApiCompany } from '../../_lib/api-guard.ts';
import { container } from '../../_lib/current-session.ts';

const Page = z.object({
  environment: z.enum(['all', 'production', 'sandbox']).default('all'),
  /** '' is everybody. A cashier who is not on this payroll simply matches nothing. */
  cashier: z.string().max(64).default(''),
  search: z.string().max(80).default(''),
  cursor: z
    .object({ createdAt: z.number().int(), id: z.string().min(1) })
    .nullish()
    .transform((value) => value ?? null),
});

export async function POST(request: Request): Promise<Response> {
  const guard = await requireApiCompany();
  if (!guard.ok) return guard.response;

  const asked = Page.safeParse(await request.json().catch(() => null));
  // A body we cannot read is a client bug, not a filter: answer an empty page
  // rather than the merchant's whole week under filters nobody chose.
  if (!asked.success) return jsonResponse({ items: [], nextCursor: null, nowSeconds: 0 });

  const list = await container().validations.listValidations({
    companyId: guard.companyId,
    environment: asked.data.environment,
    cashierId: asked.data.cashier.trim() || undefined,
    search: asked.data.search.trim() || undefined,
    cursor: asked.data.cursor ?? undefined,
  });

  return jsonResponse({ items: list.items, nextCursor: list.nextCursor, nowSeconds: list.to });
}
