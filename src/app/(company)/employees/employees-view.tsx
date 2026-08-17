'use client';

/**
 * The employees screen's interactive shell: the "Nuevo empleado" button, the
 * table, and the create/edit dialog they share. A client component because the
 * dialog opens from two places at once — the header button (create) and a click
 * on any row (edit) — so both need the same piece of state.
 *
 * **Every row is editable and every row has the access switch**, the merchant's
 * own administrator included. A shop with two owners can take one of them off
 * the panel, and one with a single owner is told why it cannot (the use case
 * counts first). What no row has is a delete: access is a column, because
 * `validations.cashier_id` names whoever confirmed each payment for as long as
 * the payment exists. The switch's click is stopped from bubbling into the
 * row's edit so the two never fire together.
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
import { EmployeeAccessButton } from './employee-access-button.tsx';
import { EmployeeDialog } from './employee-dialog.tsx';

type DialogState =
  | null
  | { readonly mode: 'create' }
  | {
      readonly mode: 'edit';
      readonly id: string;
      readonly name: string;
      readonly username: string;
      /** Only a cashier is offered a PIN — see `employee-dialog.tsx`. */
      readonly isCashier: boolean;
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
                <th>Estado</th>
                <th>Último acceso</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const isCashier = e.role === 'cashier';
                const active = e.status === 'active';
                const openEdit = () =>
                  setDialog({
                    mode: 'edit',
                    id: e.id,
                    name: e.name,
                    // A cashier's handle is their username; everyone else signs
                    // in with their email, and the dialog shows what it is.
                    username: (isCashier ? e.username : e.email) ?? '',
                    isCashier,
                  });
                return (
                  <tr
                    key={e.id}
                    onClick={openEdit}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openEdit();
                      }
                    }}
                    tabIndex={0}
                    className={cn('cursor-pointer', !active && 'opacity-60')}
                  >
                    <td className="font-heading">{e.name}</td>
                    <td className="text-muted-foreground">{e.username ?? e.email}</td>
                    <td>
                      <Badge variant={isCashier ? 'accent' : 'neutral'}>
                        {isCashier ? 'Cajero' : 'Empresa'}
                      </Badge>
                    </td>
                    <td>
                      {active ? (
                        <span className="text-xs text-muted-foreground">Activo</span>
                      ) : (
                        <Badge variant="neutral">Inhabilitado</Badge>
                      )}
                    </td>
                    <td className="text-muted-foreground">
                      {e.lastLoginAt === null ? 'Nunca' : formatDayClock(e.lastLoginAt, nowSeconds)}
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <EmployeeAccessButton userId={e.id} name={e.name} active={active} />
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
              ? {
                  id: dialog.id,
                  name: dialog.name,
                  username: dialog.username,
                  isCashier: dialog.isCashier,
                }
              : null
          }
          onClose={() => setDialog(null)}
        />
      )}
    </ContentLayout>
  );
}
