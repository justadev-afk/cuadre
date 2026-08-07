'use client';

/**
 * The list of validated payments — the cashier's "mis validaciones" and the
 * company panel both draw it: a table on a wide screen, cards on a phone, and a
 * row/card opens the full receipt in a modal the way the counter re-opens a
 * charge. A row here is always a *confirmed* payment (the store has no
 * unconfirmed row), so there is no status column; the sandbox tag is the only
 * badge and it reads the flag copied onto the row, never a join.
 */
import { useState } from 'react';

import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog.tsx';
import type { Validation } from '../../adapters/d1/validation.repository.ts';
import { formatBolivares } from '../../domain/money.ts';
import { formatPhoneForDisplay } from '../../domain/phone.ts';
import { findBank } from '../../domain/sudeban.ts';
import {
  amountDigits,
  formatClock,
  formatDateTime,
  formatDayClock,
} from '../_lib/venezuela-format.ts';
import { Icon } from './icon.tsx';

const BANK_NAMES: Record<string, string> = { banesco: 'Banesco' };

export function ValidationList({
  items,
  nowSeconds,
  showCashier = false,
}: {
  items: readonly Validation[];
  nowSeconds: number;
  /** The company panel shows who validated each payment; a cashier's own does not. */
  showCashier?: boolean;
}) {
  const [viewing, setViewing] = useState<Validation | null>(null);

  const open = (v: Validation) => setViewing(v);

  return (
    <>
      {/* Wide screen: a table, each row a button that re-opens the receipt. */}
      <Card className="hidden overflow-x-auto p-0 min-[900px]:block">
        <table className="table">
          <thead>
            <tr>
              <th>Control</th>
              <th>Hora</th>
              <th>Referencia</th>
              <th className="text-right">Monto (Bs)</th>
              <th>Teléfono</th>
              {showCashier && <th>Cajero</th>}
              <th>Banco</th>
            </tr>
          </thead>
          <tbody>
            {items.map((v) => (
              <tr
                key={v.id}
                tabIndex={0}
                onClick={() => open(v)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    open(v);
                  }
                }}
                className="cursor-pointer"
              >
                <td className="font-heading tabular-nums text-[var(--color-accent-300)]">
                  {v.controlCode}
                </td>
                <td className="whitespace-nowrap text-muted-foreground">{formatClock(v.trnAt)}</td>
                <td className="tabular-nums">{v.reference}</td>
                <td className="text-right font-heading tabular-nums">
                  {amountDigits(v.amountCents)}
                </td>
                <td className="tabular-nums text-muted-foreground">{v.payerPhone}</td>
                {showCashier && (
                  <td className="whitespace-nowrap text-muted-foreground">
                    {v.cashierName ?? '—'}
                  </td>
                )}
                <td className="whitespace-nowrap">
                  {BANK_NAMES[v.bank] ?? v.bank}
                  {v.isSandbox && (
                    <Badge variant="outline" className="ml-1.5 text-[10px]">
                      <Icon name="flask" />
                      Sandbox
                    </Badge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Phone: one card per payment, tappable. */}
      <div className="flex flex-col gap-2 min-[900px]:hidden">
        {items.map((v) => (
          <button
            type="button"
            key={v.id}
            onClick={() => open(v)}
            className="flex cursor-pointer flex-col gap-1 rounded-md bg-card px-3.5 py-3 text-left shadow-[var(--shadow-sm)] transition-colors hover:bg-foreground/[0.04]"
          >
            <div className="flex items-center gap-1.5">
              <div className="font-heading text-base">{formatBolivares(v.amountCents)}</div>
              <span className="font-heading text-xs tabular-nums text-[var(--color-accent-300)]">
                {v.controlCode}
              </span>
              {v.isSandbox && (
                <Badge variant="outline" className="text-[10px]">
                  <Icon name="flask" />
                  Sandbox
                </Badge>
              )}
            </div>
            <span className="text-xs text-muted-foreground">
              {formatDayClock(v.trnAt, nowSeconds)} · ref{' '}
              <span className="tabular-nums">{v.reference}</span> ·{' '}
              <span className="tabular-nums">{v.payerPhone}</span>
            </span>
            {showCashier && v.cashierName && (
              <span className="text-xs text-muted-foreground">Cajero · {v.cashierName}</span>
            )}
          </button>
        ))}
      </div>

      {viewing !== null && (
        <ValidationDetailModal validation={viewing} onClose={() => setViewing(null)} />
      )}
    </>
  );
}

/** The receipt for one validation — the same shape the counter shows on confirm. */
function ValidationDetailModal({
  validation,
  onClose,
}: {
  validation: Validation;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const payerBank = findBank(validation.sourceBankId);

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="w-[min(440px,calc(100%-2rem))]" aria-describedby={undefined}>
        <div className="flex items-center gap-3.5">
          <span className="grid size-[52px] shrink-0 place-items-center rounded-full border border-primary bg-primary/[0.14] text-2xl text-primary">
            <Icon name="check" />
          </span>
          <div className="flex-1">
            <DialogTitle className="text-xl">Cobro validado</DialogTitle>
            <span className="text-xs text-muted-foreground">
              {BANK_NAMES[validation.bank] ?? validation.bank} · {formatDateTime(validation.trnAt)}
            </span>
          </div>
          {validation.isSandbox && (
            <Badge variant="outline">
              <Icon name="flask" />
              Sandbox
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2 rounded-md border border-dashed border-[var(--color-accent-700)] bg-primary/[0.07] p-3.5">
          <div className="flex-1">
            <span className="text-[10px] tracking-[0.1em] text-muted-foreground uppercase">
              Código de control
            </span>
            <div className="font-heading text-[28px] tracking-[0.14em] tabular-nums text-primary">
              {validation.controlCode}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label={copied ? 'Código copiado' : 'Copiar el código de control'}
            onClick={async () => {
              await navigator.clipboard.writeText(validation.controlCode);
              setCopied(true);
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} />
          </Button>
        </div>

        <div className="flex flex-col gap-2.5 text-[13px]">
          <DetailRow label="Monto" strong value={formatBolivares(validation.amountCents)} />
          <DetailRow label="Referencia" mono value={validation.reference} />
          <DetailRow label="Teléfono" value={formatPhoneForDisplay(validation.payerPhone)} />
          {payerBank !== null && <DetailRow label="Banco emisor" value={payerBank.name} />}
          {validation.cashierName && <DetailRow label="Cajero" value={validation.cashierName} />}
          <DetailRow label="Fecha" value={formatDateTime(validation.trnAt)} />
        </div>

        <Button size="block" className="h-10" onClick={onClose}>
          Cerrar
        </Button>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
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
      <span className={strong ? 'font-heading text-[17px]' : mono ? 'tabular-nums' : undefined}>
        {value}
      </span>
    </div>
  );
}

/** The empty state — screen 27. */
export function NoValidations({ cta }: { cta?: { href: string; label: string } }) {
  return (
    <div className="flex flex-col items-center gap-2 py-[34px] text-center">
      <span className="grid size-11 place-items-center rounded-full bg-sidebar text-[22px] text-muted-foreground">
        <Icon name="receipt" />
      </span>
      <div className="font-heading text-base">Todavía no validas nada hoy</div>
      <span className="max-w-[28ch] text-xs text-muted-foreground">
        El primer cobro del día aparecerá aquí.
      </span>
      {cta && (
        <Button asChild className="mt-2">
          <a href={cta.href}>{cta.label}</a>
        </Button>
      )}
    </div>
  );
}
