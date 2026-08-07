/**
 * Screen 10 — the company's employees (CRUD).
 *
 * The list is fetched here and handed to the client `EmployeesView`, which owns
 * the one interactive concern: the create/edit dialog, opened by the header
 * button or a click on a cashier row. Delete remains a plain server-action form
 * inside that view, so removing access still works without client JS.
 */
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { EmployeesView } from './employees-view.tsx';

export const metadata = { title: 'Empleados · Cuadre' };

export default async function EmployeesPage() {
  const { companyId } = await requireCompany();
  const employees = await container().employees.listEmployees({ companyId });
  const nowSeconds = Math.floor(Date.now() / 1000);

  return <EmployeesView employees={employees} nowSeconds={nowSeconds} />;
}
