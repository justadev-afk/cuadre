/**
 * The counter's shell: the authoritative role check, the v2 application frame,
 * and the shift prompt.
 *
 * `middleware.ts` already bounced anonymous traffic away from `/checkout` on the
 * cheap cookie test, but a cookie is not a session — it can name a record KV has
 * forgotten, or a user whose role changed since. So this resolves it for real,
 * and a caller who cannot reach the counter is sent to `/`.
 *
 * The counter is shared: a cashier reaches it, and so does a company owner
 * working the till. The shell reads the session's role, so each keeps their own
 * left rail — a company owner here still sees their own nav, not the cashier's.
 */
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { canReach, usesExpressTill } from '../../application/session.ts';
import { AppShell } from '../_components/app-shell.tsx';
import { ShiftDialog } from '../_components/shift-dialog.tsx';
import { sessionOnce } from '../_lib/area-guard.ts';
import { container } from '../_lib/current-session.ts';
import { PWA_SIZE } from '../_lib/pwa-size.ts';
import { isLiveSession, signedOutPath } from '../_lib/session-exit.ts';
import { shellModel } from '../_lib/shell-nav.ts';

export default async function CashierLayout({ children }: { children: ReactNode }) {
  // `sessionOnce`, not `currentSession`: the page below asks the same question
  // to decide whether a standalone app is forwarded on, and the till is the one
  // screen where a second KV round trip is felt.
  const resolution = await sessionOnce();
  if (!isLiveSession(resolution)) redirect(signedOutPath(resolution));

  const resolved = resolution.active;
  const { session } = resolved;
  if (!canReach(session.role, 'counter')) redirect('/');

  const detail = session.companyId
    ? await container().companies.getCompany({ companyId: session.companyId })
    : null;
  const company =
    detail?.ok === true ? { name: detail.value.company.name, code: detail.value.company.id } : null;

  return (
    <AppShell
      model={shellModel(session, company)}
      // A cashier who reaches the shell till is on their way to the express
      // window (StandaloneRedirect) when running as a PWA — size to it so the
      // hop does not resize twice. A company owner working the till never makes
      // that hop, so they keep the roomy panel: one rule, `usesExpressTill`.
      pwaSize={usesExpressTill(session.role) ? PWA_SIZE.express : PWA_SIZE.panel}
    >
      {children}
      {resolved.needsShiftConfirmation && session.role === 'cashier' && (
        <ShiftDialog name={session.name} username={session.username} since={session.createdAt} />
      )}
    </AppShell>
  );
}
