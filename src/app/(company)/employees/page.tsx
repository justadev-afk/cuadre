/**
 * Screen 10 — the company's employees.
 *
 * The list is fetched here and handed to the client `EmployeesView`, which owns
 * the interactive concerns: the create/edit dialog (the header button, or a
 * click on any row) and the access switch. The order — administrators first,
 * then cashiers — is `listEmployees`', not the screen's.
 *
 * `currentUserId` travels with it because one row is different: your own, which
 * has no access switch. Nobody signs themselves out of their own panel. The
 * endpoint refuses it too; this is only so the button is not there to press.
 */
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { pageMeta } from '../../_lib/page-meta.ts';
import { EmployeesView } from './employees-view.tsx';

export const metadata = pageMeta('Empleados');

export default async function EmployeesPage() {
  const { companyId, resolved } = await requireCompany();
  const employees = await container().employees.listEmployees({ companyId });
  const nowSeconds = Math.floor(Date.now() / 1000);

  return (
    <EmployeesView
      employees={employees}
      nowSeconds={nowSeconds}
      currentUserId={resolved.session.userId}
    />
  );
}
