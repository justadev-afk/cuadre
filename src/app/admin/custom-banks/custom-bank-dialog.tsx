'use client';

/**
 * One dialog for creating a custom payer bank and for editing one — the same
 * form, because it is the same question (§11).
 *
 * Two of the four fields decide where a payment question is sent, so the copy
 * under them says it plainly rather than leaving it to be inferred:
 *
 *  - **el código** is the brand's identity. It is what lands in
 *    `validations.source_bank_id` and therefore what a year of receipts already
 *    names, so it is **read-only** once written — rendered as the same control,
 *    disabled, never as a different widget.
 *  - **el banco real** is the Sudeban code the search actually carries. Picked
 *    from Sudeban's own list, never typed: a code that is not in that table is a
 *    question no bank answers.
 *  - **el teléfono fijo** is optional, and empty means something specific — the
 *    bank is asked with the number the cashier typed. The helper line says so,
 *    because a blank field otherwise reads as "not configured yet".
 *
 * Every field is controlled so a refusal keeps what was typed, and the refusal
 * is a toast rather than a line grown inside the modal.
 */
import { useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Checkbox } from '@/components/ui/checkbox.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import type { CustomPayerBank } from '../../../domain/payer-bank.ts';
import { formatPhoneForDisplay } from '../../../domain/phone.ts';
import { SUDEBAN_BANKS } from '../../../domain/sudeban.ts';
import { SearchableSelect, type SelectOption } from '../../_components/searchable-select.tsx';
import { API } from '../../_lib/endpoints.ts';
import { useActionOutcome } from '../../_lib/use-action-outcome.ts';
import { useEndpointAction } from '../../_lib/use-endpoint-action.ts';
import { SAVE_CUSTOM_BANK_INITIAL, type SaveCustomBankState } from './form-state.ts';

/** Sudeban's own list, shaped once for the dropdown. The target is one of these. */
const TARGET_OPTIONS: readonly SelectOption[] = SUDEBAN_BANKS.map((bank) => ({
  value: bank.code,
  label: bank.name,
  hint: bank.code,
}));

export function CustomBankDialog({
  bank,
  onClose,
}: {
  /** Present → edit that brand; absent → create a new one. */
  bank: CustomPayerBank | null;
  onClose: () => void;
}) {
  const editing = bank !== null;
  const [state, action, pending] = useEndpointAction<SaveCustomBankState>(
    API.customBanksSave,
    SAVE_CUSTOM_BANK_INITIAL,
  );

  const [code, setCode] = useState(bank?.code ?? '');
  const [name, setName] = useState(bank?.name ?? '');
  const [targetBankId, setTargetBankId] = useState(bank?.targetBankId ?? '');
  // Shown the way every phone is shown here (0414-2698301) and normalised back
  // to E.164 on the server, so the admin reads the same spelling as the panel.
  const [phone, setPhone] = useState(
    bank?.targetPhone == null ? '' : formatPhoneForDisplay(bank.targetPhone),
  );
  const [active, setActive] = useState(bank === null || bank.status === 'active');

  useActionOutcome(state, onClose);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="w-[min(460px,calc(100%-2rem))]">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar banco custom' : 'Nuevo banco custom'}</DialogTitle>
          <DialogDescription>
            El cajero lo elige por su nombre; la consulta viaja al banco real que elijas aquí.
          </DialogDescription>
        </DialogHeader>

        <form action={action} className="flex flex-col gap-3.5">
          {/* Which of the two flows this is, so one endpoint can serve both. */}
          <input type="hidden" name="creating" value={editing ? '' : 'on'} />
          {editing && <input type="hidden" name="code" value={bank.code} />}
          {/* The picker is not a native field, so the value travels as one. */}
          <input type="hidden" name="targetBankId" value={targetBankId} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-name">Nombre</Label>
            <Input
              id="cb-name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ubii"
              maxLength={40}
              disabled={pending}
              required
            />
            <p className="m-0 text-xs text-muted-foreground">
              Lo que ve el cajero en «Banco emisor» y lo que sale en cada listado.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-code">Código</Label>
            <Input
              id="cb-code"
              // Not submitted while editing: the hidden field above carries it,
              // and this one is the same control, disabled — a form the admin
              // recognises, with the field they may not change turned off.
              name={editing ? undefined : 'code'}
              value={code}
              onChange={(e) => setCode(e.target.value.toLowerCase())}
              placeholder="ubii"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={24}
              disabled={pending || editing}
              className={editing ? 'opacity-70' : undefined}
              required
            />
            <p className="m-0 text-xs text-muted-foreground">
              {editing
                ? 'No cambia: es lo que ya nombra los pagos cobrados con este banco.'
                : 'Minúsculas, números y guiones. Nunca cuatro dígitos, para no chocar con Sudeban.'}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-target">Banco real</Label>
            <SearchableSelect
              id="cb-target"
              options={TARGET_OPTIONS}
              value={targetBankId}
              onChange={setTargetBankId}
              placeholder="Elige el banco emisor real"
              searchPlaceholder="Buscar banco…"
              disabled={pending}
            />
            <p className="m-0 text-xs text-muted-foreground">
              Es el código que se le envía al banco al validar el pago.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cb-phone">Teléfono fijo (opcional)</Label>
            <Input
              id="cb-phone"
              name="targetPhone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0414-2698301"
              inputMode="tel"
              maxLength={20}
              disabled={pending}
            />
            <p className="m-0 text-xs text-muted-foreground">
              Se envía este número en lugar del que escriba el cajero. Déjalo vacío para consultar
              con el del cajero.
            </p>
          </div>

          <Label className="mt-1 cursor-pointer text-sm text-foreground">
            <Checkbox
              name="active"
              checked={active}
              onCheckedChange={(value) => setActive(value === true)}
              disabled={pending}
            />
            Disponible en la caja
          </Label>

          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || targetBankId === ''}>
              {pending ? 'Guardando…' : 'Guardar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
