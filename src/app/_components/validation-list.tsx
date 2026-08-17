'use client';

/**
 * The list of validated payments — the cashier's "mis validaciones" and the
 * company panel both draw it: a table on a wide screen, cards on a phone, and a
 * row/card opens the full receipt in a modal the way the counter re-opens a
 * charge. A row here is always a *confirmed* payment (the store has no
 * unconfirmed row), so there is no status column; the sandbox tag is the only
 * badge and it reads the flag copied onto the row, never a join.
 */
import Link from 'next/link';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import type { Validation } from '../../adapters/d1/validation.repository.ts';
import { formatBolivares } from '../../domain/money.ts';
import { findBank } from '../../domain/sudeban.ts';
import { amountDigits, formatClock, formatDayClock } from '../_lib/venezuela-format.ts';
import { Icon } from './icon.tsx';
import { PaymentKindMark } from './payment-kind-mark.tsx';
import { ValidatedPaymentModal } from './validated-payment-modal.tsx';

const BANK_NAMES: Record<string, string> = { banesco: 'Banesco' };

export function ValidationList({
  items,
  nowSeconds,
  showCashier = false,
  merchantName,
  merchantRif,
}: {
  items: readonly Validation[];
  nowSeconds: number;
  /** The company panel shows who validated each payment; a cashier's own does not. */
  showCashier?: boolean;
  /** Printed at the top of a re-opened receipt, under "CUADRE". */
  merchantName?: string;
  /** And their RIF, under the name. */
  merchantRif?: string;
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
              {/* No heading: the column is one glyph wide and its meaning is
                  under the pointer. The word still reaches a screen reader,
                  from the mark's own aria-label. */}
              <th className="w-5" />
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
                <td className="pr-0">
                  <PaymentKindMark
                    kind={v.kind}
                    searchMode={v.searchMode}
                    payerPhone={v.payerPhone}
                  />
                </td>
                <td className="font-heading tabular-nums text-[var(--color-accent-300)]">
                  {v.controlCode}
                </td>
                <td className="whitespace-nowrap text-muted-foreground">{formatClock(v.trnAt)}</td>
                <td className="tabular-nums">{v.reference}</td>
                <td className="text-right font-heading tabular-nums">
                  {amountDigits(v.amountCents)}
                </td>
                {/* A transferencia has no payer phone — the cell says so. */}
                <td className="tabular-nums text-muted-foreground">{v.payerPhone ?? '—'}</td>
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
              {/* On a phone the mark carries no tooltip worth tapping — the card
                  itself opens the receipt, which spells the kind out. */}
              <PaymentKindMark kind={v.kind} searchMode={v.searchMode} payerPhone={v.payerPhone} />
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
              <span className="tabular-nums">{v.reference}</span>
              {v.payerPhone !== null && (
                <>
                  {' · '}
                  <span className="tabular-nums">{v.payerPhone}</span>
                </>
              )}
            </span>
            {showCashier && v.cashierName && (
              <span className="text-xs text-muted-foreground">Cajero · {v.cashierName}</span>
            )}
          </button>
        ))}
      </div>

      {viewing !== null && (
        <ValidatedPaymentModal
          view={{
            controlCode: viewing.controlCode,
            amountCents: viewing.amountCents,
            reference: viewing.reference,
            payerPhone: viewing.payerPhone,
            kind: viewing.kind,
            // The stored Sudeban code, as a name. An unknown code shows as the
            // four digits rather than as nothing: the row says what the bank was
            // asked with, and that is true even when the list has moved on.
            payerBankName: findBank(viewing.sourceBankId)?.name ?? viewing.sourceBankId,
            bankName: BANK_NAMES[viewing.bank] ?? viewing.bank,
            cashierName: viewing.cashierName,
            paidAt: viewing.trnAt,
            chargedAt: viewing.createdAt,
            isSandbox: viewing.isSandbox,
            receipt: {
              merchantName,
              merchantRif,
              controlCode: viewing.controlCode,
              kind: viewing.kind,
              reference: viewing.reference,
              amountCents: viewing.amountCents,
              payerPhone: viewing.payerPhone,
              bankName: BANK_NAMES[viewing.bank] ?? viewing.bank,
              cashierName: viewing.cashierName,
              paidAt: viewing.trnAt,
              atSeconds: viewing.createdAt,
              isSandbox: viewing.isSandbox,
            },
          }}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

/** The empty state — screen 27. */
export function NoValidations({
  cta,
  title = 'Todavía no validas nada hoy',
  hint = 'El primer cobro del día aparecerá aquí.',
}: {
  cta?: { href: string; label: string };
  /** Range-aware copy — "hoy" is only right on today's list. */
  title?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-[34px] text-center">
      <span className="grid size-11 place-items-center rounded-full bg-sidebar text-[22px] text-muted-foreground">
        <Icon name="receipt" />
      </span>
      <div className="font-heading text-base">{title}</div>
      <span className="max-w-[28ch] text-xs text-muted-foreground">{hint}</span>
      {cta && (
        <Button asChild className="mt-2">
          <Link href={cta.href}>{cta.label}</Link>
        </Button>
      )}
    </div>
  );
}
