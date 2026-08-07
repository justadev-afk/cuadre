/**
 * The counter's shell: the authoritative role check and the shift prompt.
 *
 * `middleware.ts` already bounced anonymous traffic away from `/checkout` on
 * the cheap cookie test, but a cookie is not a session — it can name a record
 * KV has forgotten, or a user whose role changed since. So this resolves it for
 * real, and a caller who cannot reach the counter is sent to `/`, which is the
 * one place that knows where each role belongs.
 *
 * The header is *not* here. A layout has no way to know which route rendered
 * under it, and `AppNav` marks the active link from the path it is given, so
 * each page passes its own.
 */
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { canReach } from '../../application/session.ts';
import { ShiftDialog } from '../_components/shift-dialog.tsx';
import { currentSession } from '../_lib/current-session.ts';

export default async function CashierLayout({ children }: { children: ReactNode }) {
  const resolved = await currentSession();
  if (resolved === null) redirect('/login');

  const { session } = resolved;
  if (!canReach(session.role, 'counter')) redirect('/');

  return (
    <>
      {children}
      {resolved.needsShiftConfirmation && (
        <ShiftDialog name={session.name} username={session.username} since={session.createdAt} />
      )}
    </>
  );
}
