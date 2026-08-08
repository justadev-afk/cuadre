/**
 * Screen 18 — the cashier's own list. The interactive shell (day tabs, search,
 * ten-at-a-time paging) is `MyValidationsView`, a client component so a tab
 * switch is instant and the header never blinks. This server page does one
 * thing: resolve the session and fetch the *first* page, so the initial paint
 * already has its rows — no loading skeleton, no client round trip before
 * anything shows. Everything is scoped to this cashier and this company.
 */
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { pageMeta } from '../../_lib/page-meta.ts';
import { MyValidationsView } from './my-validations-view.tsx';

export const metadata = pageMeta('Mis validaciones');

export default async function MyValidationsPage() {
  const { session } = await requireArea('counter');
  const detail = session.companyId
    ? await container().companies.getCompany({ companyId: session.companyId })
    : null;
  const merchantName = detail?.ok ? detail.value.company.name : undefined;

  const list =
    session.companyId === null
      ? { items: [], nextCursor: null, to: 0 }
      : await container().validations.listMyValidations({
          companyId: session.companyId,
          cashierId: session.userId,
          range: 'today',
        });

  return (
    <MyValidationsView
      initialItems={list.items}
      initialNextCursor={list.nextCursor}
      initialNowSeconds={list.to}
      merchantName={merchantName}
    />
  );
}
