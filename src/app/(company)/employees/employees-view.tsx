'use client';

/**
 * The employees screen's interactive shell: the "Nuevo empleado" button, the
 * table, and the create/edit dialog they share. A client component because the
 * dialog opens from two places at once — the header button (create) and a click
 * on any cashier row (edit) — so both need the same piece of state.
 *
 * Delete stays a plain server-action form so revoking access works even if this
 * component never hydrates; its click is stopped from bubbling into the row's
 * edit so the two never fire together.
 */
import { useState } from 'react';

import type { Employee } from '../../../application/employees/employee.ts';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { Icon } from '../../_components/icon.tsx';
import { formatDayClock } from '../../_lib/venezuela-format.ts';
import { deleteEmployeeAction } from './actions.ts';
import { EmployeeDialog } from './employee-dialog.tsx';

type DialogState =
  | null
  | { readonly mode: 'create' }
  | {
      readonly mode: 'edit';
      readonly id: string;
      readonly name: string;
      readonly username: string;
    };

export function EmployeesView({
  employees,
  nowSeconds,
}: {
  employees: readonly Employee[];
  nowSeconds: number;
}) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const cashiers = employees.filter((e) => e.role === 'cashier');

  return (
    <ContentLayout
      title="Empleados"
      subtitle={`${employees.length} ${employees.length === 1 ? 'usuario' : 'usuarios'} · ${cashiers.length} con acceso a caja`}
      actions={
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setDialog({ mode: 'create' })}
        >
          <Icon name="plus" />
          Nuevo empleado
        </button>
      }
    >
      {employees.length === 0 ? (
        <section className="box">
          <p className="text-muted" style={{ fontSize: 14, textAlign: 'center', margin: '12px 0' }}>
            Todavía no has creado empleados.
          </p>
        </section>
      ) : (
        <section className="box" style={{ padding: 0, overflowX: 'auto' }}>
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
              {employees.map((e) => {
                const isCashier = e.role === 'cashier';
                const openEdit = () =>
                  setDialog({ mode: 'edit', id: e.id, name: e.name, username: e.username ?? '' });
                return (
                  <tr
                    key={e.id}
                    onClick={isCashier ? openEdit : undefined}
                    onKeyDown={
                      isCashier
                        ? (event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openEdit();
                            }
                          }
                        : undefined
                    }
                    tabIndex={isCashier ? 0 : undefined}
                    style={isCashier ? { cursor: 'pointer' } : undefined}
                  >
                    <td style={{ fontFamily: 'var(--font-heading)' }}>{e.name}</td>
                    <td className="text-muted">{e.username ?? e.email}</td>
                    <td>
                      <span className={isCashier ? 'tag tag-accent' : 'tag tag-neutral'}>
                        {isCashier ? 'Cajero' : 'Empresa'}
                      </span>
                    </td>
                    <td className="text-muted">
                      {e.lastLoginAt === null ? 'Nunca' : formatDayClock(e.lastLoginAt, nowSeconds)}
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {isCashier && (
                        <form action={deleteEmployeeAction} style={{ display: 'inline' }}>
                          <input type="hidden" name="userId" value={e.id} />
                          <button
                            type="submit"
                            className="btn btn-ghost"
                            aria-label={`Eliminar a ${e.name}`}
                            style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Icon name="trash" />
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {dialog !== null && (
        <EmployeeDialog
          employee={
            dialog.mode === 'edit'
              ? { id: dialog.id, name: dialog.name, username: dialog.username }
              : null
          }
          onClose={() => setDialog(null)}
        />
      )}
    </ContentLayout>
  );
}
