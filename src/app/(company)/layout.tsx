/**
 * The company shell: the authoritative role check for a merchant's own area,
 * and the v2 application frame the pages render inside.
 *
 * Everything below it is scoped by the session's `companyId` and by nothing the
 * client sent — that is the boundary between merchants, and it starts here. A
 * cookie naming a non-company session is sent to `/`, which routes each role to
 * where it belongs.
 */
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { canReach } from '../../application/session.ts';
import { AppShell } from '../_components/app-shell.tsx';
import { container, currentSession } from '../_lib/current-session.ts';
import { shellModel } from '../_lib/shell-nav.ts';

export default async function CompanyLayout({ children }: { children: ReactNode }) {
  const resolution = await currentSession();
  if (resolution.kind === 'anonymous') redirect('/login');
  if (resolution.kind === 'superseded') redirect('/session-ended');

  const { session } = resolution.active;
  if (!canReach(session.role, 'company')) redirect('/');

  const companyId = session.companyId;
  const detail = companyId ? await container().companies.getCompany({ companyId }) : null;
  const company =
    detail?.ok === true ? { name: detail.value.company.name, code: detail.value.company.id } : null;

  return <AppShell model={shellModel(session, company)}>{children}</AppShell>;
}
