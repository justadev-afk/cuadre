/**
 * The shell for the admin overview. A sibling of `admin/companies/layout.tsx`
 * and identical to it on purpose: each authenticated admin subtree renders the
 * shell for itself, so `/admin/login` — which is a sibling of both — stays
 * outside the frame and never wears the application chrome.
 */
import type { ReactNode } from 'react';

import { AppShell } from '../../_components/app-shell.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { shellModel } from '../../_lib/shell-nav.ts';

export default async function AdminOverviewLayout({ children }: { children: ReactNode }) {
  const resolved = await requireArea('admin');
  return <AppShell model={shellModel(resolved.session)}>{children}</AppShell>;
}
