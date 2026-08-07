/**
 * Screen 10 — the company's employees (CRUD).
 *
 * Cashiers, scoped to this company by the session. Delete is a plain form
 * posting to a server action, so removing access works without client JS; the
 * "nuevo empleado" dialog is the one interactive leaf.
 */
import { AppNav } from '../../_components/app-nav.tsx';
import { Icon } from '../../_components/icon.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { formatDayClock } from '../../_lib/venezuela-format.ts';
import { COMPANY_LINKS } from '../_lib/nav.ts';
import { deleteEmployeeAction } from './actions.ts';
import { NewEmployeeDialog } from './new-employee-dialog.tsx';

export const metadata = { title: 'Empleados · Cuadre' };

export default async function EmployeesPage() {
  const { resolved, companyId } = await requireCompany();
  const employees = await container().employees.listEmployees({ companyId });
  const nowSeconds = Math.floor(Date.now() / 1000);
  const cashiers = employees.filter((e) => e.role === 'cashier');

  return (
    <>
      <AppNav
        links={COMPANY_LINKS}
        current="/employees"
        roleLabel="Empresa"
        who={resolved.session.name}
      />

      <main style={{ padding: '26px 24px', maxWidth: 760, marginInline: 'auto', width: '100%' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div>
            <h4 style={{ margin: '0 0 2px' }}>Empleados</h4>
            <span className="text-muted" style={{ fontSize: 13 }}>
              {employees.length} {employees.length === 1 ? 'usuario' : 'usuarios'} ·{' '}
              {cashiers.length} con acceso a caja
            </span>
          </div>
          <NewEmployeeDialog />
        </div>

        {employees.length === 0 ? (
          <p
            className="text-muted"
            style={{ fontSize: 14, padding: '24px 0', textAlign: 'center' }}
          >
            Todavía no has creado empleados.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Usuario</th>
                  <th>Rol</th>
                  <th>Último acceso</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td style={{ fontFamily: 'var(--font-heading)' }}>{e.name}</td>
                    <td className="text-muted">{e.username ?? e.email}</td>
                    <td>
                      <span className={e.role === 'cashier' ? 'tag tag-accent' : 'tag tag-neutral'}>
                        {e.role === 'cashier' ? 'Cajero' : 'Empresa'}
                      </span>
                    </td>
                    <td className="text-muted">
                      {e.lastLoginAt === null ? 'Nunca' : formatDayClock(e.lastLoginAt, nowSeconds)}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {e.role === 'cashier' && (
                        <form action={deleteEmployeeAction} style={{ display: 'inline' }}>
                          <input type="hidden" name="userId" value={e.id} />
                          <button
                            type="submit"
                            className="btn btn-ghost"
                            aria-label={`Eliminar a ${e.name}`}
                            style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}
                          >
                            <Icon name="trash" />
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
