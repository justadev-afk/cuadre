/**
 * The shell for the admin observability screen — a sibling of
 * `admin/overview/layout.tsx` and `admin/companies/layout.tsx`, identical on
 * purpose so every authenticated admin subtree wears the same chrome while
 * `/admin/login` stays outside the frame.
 */
import type { ReactNode } from 'react';

import { AppShell } from '../../_components/app-shell.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { shellModel } from '../../_lib/shell-nav.ts';

export default async function AdminObservabilityLayout({ children }: { children: ReactNode }) {
  const resolved = await requireArea('admin');
  return <AppShell model={shellModel(resolved.session)}>{children}</AppShell>;
}
