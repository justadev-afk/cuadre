'use client';

/**
 * One "Cobro validado" modal, for every place a validated payment is re-opened:
 * the counter's "mi turno" row and the validations list both render this, so the
 * two can never drift — same header, same control-code hero, same rows, same
 * print, same thermal receipt. It mirrors the confirmation the counter sees the
 * moment a payment validates; the only difference there is the actions (a fresh
 * confirmation offers "Nuevo cobro", a re-open offers "Cerrar").
 */
import { useState } from 'react';

import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import { cn } from '@/lib/utils.ts';
import { formatBolivares } from '../../domain/money.ts';
import { formatPhoneForDisplay } from '../../domain/phone.ts';
import { formatDateTime } from '../_lib/venezuela-format.ts';
import { Icon } from './icon.tsx';
import { PrintReceiptButton, type ReceiptData, ThermalReceipt } from './thermal-receipt.tsx';

/** Everything the modal shows, from whichever surface opened it. */
export type ValidatedPaymentView = {
  readonly controlCode: string;
  readonly amountCents: number;
  readonly reference: string;
  /** `null` for a transferencia: the payment carried no payer phone. */
  readonly payerPhone: string | null;
  /** The bank that answered, as a name (e.g. "Banesco"). */
  readonly bankName: string;
  readonly cashierName?: string | null;
  /** "Banesco ···· 5394" — the account the payment landed on, when known. */
  readonly accountLabel?: string;
  /** Epoch seconds — the bank's transaction time. */
  readonly atSeconds: number;
  readonly isSandbox: boolean;
  /** What the printed ticket needs. */
  readonly receipt: ReceiptData;
};

const MARK_OK =
  'grid size-[52px] shrink-0 place-items-center rounded-full border border-primary bg-primary/[0.14] text-2xl text-primary';

export function ValidatedPaymentModal({
  view,
  onClose,
}: {
  view: ValidatedPaymentView;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="w-[min(440px,calc(100%-2rem))]" aria-describedby={undefined}>
        <div className="flex items-center gap-3.5">
          <span className={MARK_OK}>
            <Icon name="check" />
          </span>
          <div className="flex-1">
            <DialogTitle className="text-xl">Cobro validado</DialogTitle>
            <span className="text-xs text-muted-foreground">
              {view.bankName} · {formatDateTime(view.atSeconds)}
            </span>
          </div>
          {view.isSandbox && (
            <Badge variant="outline">
              <Icon name="flask" />
              Sandbox
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-md border border-[var(--color-accent-700)] border-dashed bg-primary/[0.07] p-3.5">
          <div className="flex-1">
            <span className="text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
              Código de control
            </span>
            <div className="font-heading text-[28px] text-primary tracking-[0.14em] tabular-nums">
              {view.controlCode}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={copied ? 'Código copiado' : 'Copiar el código de control'}
            onClick={async () => {
              await navigator.clipboard.writeText(view.controlCode);
              setCopied(true);
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} />
          </Button>
        </div>

        <div className="flex flex-col gap-2.5 text-[13px]">
          <Row label="Monto" strong value={formatBolivares(view.amountCents)} />
          <Row label="Referencia" mono value={view.reference} />
          {view.payerPhone !== null ? (
            <Row label="Teléfono" value={formatPhoneForDisplay(view.payerPhone)} />
          ) : null}
          {view.accountLabel ? <Row label="Cuenta" value={view.accountLabel} /> : null}
          {view.cashierName ? <Row label="Cajero" value={view.cashierName} /> : null}
          <Row label="Fecha" value={formatDateTime(view.atSeconds)} />
        </div>

        <div className="flex gap-2">
          <PrintReceiptButton className="h-10 flex-1" />
          <Button className="h-10 flex-1" onClick={onClose}>
            Cerrar
          </Button>
        </div>

        <ThermalReceipt data={view.receipt} />
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  value,
  strong,
  mono,
}: {
  label: string;
  value: string;
  strong?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn(mono && 'tabular-nums', strong && 'font-heading text-[17px]')}>
        {value}
      </span>
    </div>
  );
}
