/**
 * The platform admin's shell. It wraps the companies list and a company's
 * detail — but not `/admin/login`, which is a sibling route, so the sign-in
 * screen never wears the application frame.
 *
 * The role check lives here, once, for every screen under it: `requireArea`
 * resolves the session (a cookie is not proof) and sends anyone who is not an
 * admin to their own landing.
 */
import type { ReactNode } from 'react';

import { AppShell } from '../../_components/app-shell.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { shellModel } from '../../_lib/shell-nav.ts';

export default async function AdminCompaniesLayout({ children }: { children: ReactNode }) {
  const resolved = await requireArea('admin');
  return <AppShell model={shellModel(resolved.session)}>{children}</AppShell>;
}
