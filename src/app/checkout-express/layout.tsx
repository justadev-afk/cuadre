/**
 * The cashier's express till — the counter with no sidebar.
 *
 * A cashier signs in and lands here: only what a till needs, in a compact PWA
 * window. The frame is a slim header (who is signed in, and a logout that is
 * always in reach) over the same two-pane checkout the shell serves at
 * `/checkout`. It resolves the session itself — a sibling of `(cashier)/layout`
 * without the `AppShell` — so a company owner or admin who lands here is bounced
 * to their own home rather than shown a chrome-less till.
 */
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { canReach } from '../../application/session.ts';
import { Brand } from '../_components/brand.tsx';
import { Icon } from '../_components/icon.tsx';
import { PwaResizer } from '../_components/pwa-resizer.tsx';
import { SessionHeartbeat } from '../_components/session-heartbeat.tsx';
import { ShiftDialog } from '../_components/shift-dialog.tsx';
import { container, currentSession } from '../_lib/current-session.ts';
import { PWA_SIZE } from '../_lib/pwa-size.ts';

export default async function CheckoutExpressLayout({ children }: { children: ReactNode }) {
  const resolution = await currentSession();
  if (resolution.kind === 'anonymous') redirect('/login');
  if (resolution.kind === 'superseded') redirect('/session-ended');

  const resolved = resolution.active;
  const { session } = resolved;
  if (!canReach(session.role, 'counter')) redirect('/');

  const detail = session.companyId
    ? await container().companies.getCompany({ companyId: session.companyId })
    : null;
  const merchantName = detail?.ok === true ? detail.value.company.name : null;

  return (
    // A definite height (h-dvh, not min-h-dvh) so the fill below has something to
    // resolve against, and overflow-hidden so the window itself never scrolls —
    // any overflow is a box's own to scroll, never the whole till's.
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <PwaResizer width={PWA_SIZE.express.width} height={PWA_SIZE.express.height} />
      <SessionHeartbeat />

      <header className="flex shrink-0 items-center justify-between gap-3 border-border border-b bg-card px-5 py-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Brand markOnly size={30} />
          <div className="min-w-0 leading-tight">
            <div className="truncate font-heading text-sm">{merchantName ?? 'Caja'}</div>
            <div className="truncate text-muted-foreground text-xs">{session.name}</div>
          </div>
        </div>

        <form action="/logout" method="post">
          <Button type="submit" variant="secondary" size="sm">
            <Icon name="sign-out" />
            Salir
          </Button>
        </form>
      </header>

      {/* No padding here: ContentLayout owns the gutters, so the express till
          sits exactly like the shell's /checkout — side padding, nothing more.
          min-h-0 lets it hold a definite height (for the fill) without growing
          past the window, so overflow lands inside a box, not on the page. */}
      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      {resolved.needsShiftConfirmation && session.role === 'cashier' && (
        <ShiftDialog name={session.name} username={session.username} since={session.createdAt} />
      )}
    </div>
  );
}
