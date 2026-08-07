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

import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { cn } from '@/lib/utils.ts';
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
        <Button onClick={() => setDialog({ mode: 'create' })}>
          <Icon name="plus" />
          Nuevo empleado
        </Button>
      }
    >
      {employees.length === 0 ? (
        <Card>
          <p className="my-3 text-center text-sm text-muted-foreground">
            Todavía no has creado empleados.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
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
                    className={cn(isCashier && 'cursor-pointer')}
                  >
                    <td className="font-heading">{e.name}</td>
                    <td className="text-muted-foreground">{e.username ?? e.email}</td>
                    <td>
                      <Badge variant={isCashier ? 'accent' : 'neutral'}>
                        {isCashier ? 'Cajero' : 'Empresa'}
                      </Badge>
                    </td>
                    <td className="text-muted-foreground">
                      {e.lastLoginAt === null ? 'Nunca' : formatDayClock(e.lastLoginAt, nowSeconds)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      {isCashier && (
                        <form action={deleteEmployeeAction} className="inline">
                          <input type="hidden" name="userId" value={e.id} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            aria-label={`Eliminar a ${e.name}`}
                            className="text-muted-foreground hover:text-destructive"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Icon name="trash" />
                          </Button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
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
