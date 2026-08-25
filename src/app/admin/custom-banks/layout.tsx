/**
 * The admin shell around the custom payer banks, exactly as it wraps the
 * companies list: the role check lives here, once, for every screen under it.
 */
import type { ReactNode } from 'react';

import { AppShell } from '../../_components/app-shell.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { shellModel } from '../../_lib/shell-nav.ts';

export default async function AdminCustomBanksLayout({ children }: { children: ReactNode }) {
  const resolved = await requireArea('admin');
  return <AppShell model={shellModel(resolved.session)}>{children}</AppShell>;
}
