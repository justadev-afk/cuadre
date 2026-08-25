'use client';

/**
 * The list of custom payer banks and the one dialog that creates or edits them.
 *
 * A client component for the same reason the companies table is: a `<tr>`
 * cannot be an `<a>`, and the whole row is the click target — with Enter and
 * Space reaching it — rather than a "editar" button hiding in the last cell.
 *
 * There is one dialog, not two. Creating a brand and editing one ask for
 * exactly the same four things, so they render the same file (§11); what
 * changes is the title, whether the code is editable and whether the row it
 * posts is new.
 */
import { useState } from 'react';

import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import type { CustomPayerBank } from '../../../domain/payer-bank.ts';
import { formatPhoneForDisplay } from '../../../domain/phone.ts';
import { findBank } from '../../../domain/sudeban.ts';
import { Icon } from '../../_components/icon.tsx';
import { CustomBankDialog } from './custom-bank-dialog.tsx';

/** `null` closes the dialog; a row edits it; `'new'` opens it empty. */
type Editing = CustomPayerBank | 'new' | null;

export function CustomBanksView({ banks }: { banks: readonly CustomPayerBank[] }) {
  const [editing, setEditing] = useState<Editing>(null);

  return (
    <>
      <div className="flex justify-end">
        <Button type="button" onClick={() => setEditing('new')}>
          <Icon name="plus" />
          Nuevo banco
        </Button>
      </div>

      {banks.length === 0 ? (
        <Card>
          <p className="m-0 py-5 text-center text-sm text-muted-foreground">
            No hay bancos custom. Se usan para marcas que Sudeban no lista.
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="table">
            <thead>
              <tr>
                <th>Banco</th>
                <th>Código</th>
                <th>Se consulta como</th>
                <th>Teléfono fijo</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {banks.map((bank) => {
                const open = () => setEditing(bank);
                const target = findBank(bank.targetBankId);
                return (
                  <tr
                    key={bank.code}
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        open();
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <td className="font-heading">{bank.name}</td>
                    <td className="text-muted-foreground">{bank.code}</td>
                    <td>
                      {target?.name ?? bank.targetBankId}{' '}
                      <span className="tabular-nums text-muted-foreground">
                        · {bank.targetBankId}
                      </span>
                    </td>
                    <td className="tabular-nums text-muted-foreground">
                      {/* No fixed number is a real setting, not a blank: it means
                          the bank is asked with whatever the cashier typed. */}
                      {bank.targetPhone === null ? (
                        <span className="text-muted-foreground">El del cajero</span>
                      ) : (
                        formatPhoneForDisplay(bank.targetPhone)
                      )}
                    </td>
                    <td>
                      <Badge variant={bank.status === 'active' ? 'accent' : 'neutral'}>
                        {bank.status === 'active' ? 'Activo' : 'Desactivado'}
                      </Badge>
                    </td>
                    <td className="text-right">
                      <Icon name="caret-right" className="text-muted-foreground" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {editing !== null && (
        <CustomBankDialog
          bank={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
