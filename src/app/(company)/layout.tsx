/**
 * The company shell: the authoritative role check for a merchant's own area.
 *
 * Everything below it is scoped by the session's `companyId` and by nothing the
 * client sent — that is the boundary between merchants, and it starts here. A
 * cookie naming a non-company session is sent to `/`, which routes each role to
 * where it belongs.
 */
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { canReach } from '../../application/session.ts';
import { currentSession } from '../_lib/current-session.ts';

export default async function CompanyLayout({ children }: { children: ReactNode }) {
  const resolved = await currentSession();
  if (resolved === null) redirect('/login');
  if (!canReach(resolved.session.role, 'company')) redirect('/');

  return <>{children}</>;
}
