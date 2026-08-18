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
import { formatPhoneForDisplay } from '../../domain/phone.ts';
import { findBank } from '../../domain/sudeban.ts';
import { bankAccountLabel } from '../_lib/bank-account-label.ts';
import { amountDigits, formatValidatedAt } from '../_lib/venezuela-format.ts';
import { Icon } from './icon.tsx';
import { PaymentKindMark } from './payment-kind-mark.tsx';
import { SkeletonCards } from './skeleton.tsx';
import { ValidatedPaymentModal } from './validated-payment-modal.tsx';

const BANK_NAMES: Record<string, string> = { banesco: 'Banesco' };

/**
 * The bank the money came from, as a name. An unknown Sudeban code shows as its
 * four digits rather than as nothing: the row records what the bank was asked
 * with, and that stays true even when our table of codes has moved on.
 */
function payerBank(v: Validation): string {
  return findBank(v.sourceBankId)?.name ?? v.sourceBankId;
}

/** And the shop's own side — the connection that received it. */
function receivingBank(v: Validation): string {
  return bankAccountLabel(BANK_NAMES[v.bank] ?? v.bank, v.accountLabel);
}

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
          <ValidationsHead showCashier={showCashier} />
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
                {/* `createdAt`, which is also what the list is ordered by, so
                    the column reads in the order the rows are in. */}
                <td className="whitespace-nowrap text-muted-foreground">
                  {formatValidatedAt(v.createdAt, nowSeconds)}
                </td>
                <td className="tabular-nums">{v.reference}</td>
                <td className="text-right font-heading tabular-nums">
                  {amountDigits(v.amountCents)}
                </td>
                {/* A transferencia has no payer phone — the cell says so. */}
                <td className="tabular-nums text-muted-foreground">
                  {v.payerPhone === null ? '—' : formatPhoneForDisplay(v.payerPhone)}
                </td>
                <td className="whitespace-nowrap text-muted-foreground">{payerBank(v)}</td>
                <td className="whitespace-nowrap">
                  {receivingBank(v)}
                  {v.isSandbox && (
                    <Badge variant="outline" className="ml-1.5 text-[10px]">
                      <Icon name="flask" />
                      Sandbox
                    </Badge>
                  )}
                </td>
                {showCashier && (
                  <td className="whitespace-nowrap text-muted-foreground">
                    {v.cashierName ?? '—'}
                  </td>
                )}
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
            // A phone has no cells to blink: under a `SkeletonMask` the whole
            // card is the placeholder, which is what `SkeletonCards` draws.
            data-sk="block"
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
              {formatValidatedAt(v.createdAt, nowSeconds)} · ref{' '}
              <span className="tabular-nums">{v.reference}</span>
              {v.payerPhone !== null && (
                <>
                  {' · '}
                  <span className="tabular-nums">{formatPhoneForDisplay(v.payerPhone)}</span>
                </>
              )}
            </span>
            {/* The two banks, in the direction the money moved. A phone has no
                columns to head, so the arrow is what says which is which. */}
            <span className="text-xs text-muted-foreground">
              {payerBank(v)} <Icon name="arrow-right" /> {receivingBank(v)}
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
            payerBankName: payerBank(viewing),
            bankName: BANK_NAMES[viewing.bank] ?? viewing.bank,
            // Named exactly as the table's column and the counter's dropdown
            // name it, so a re-opened receipt matches the row it came from.
            accountLabel: receivingBank(viewing),
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

/**
 * The table's head, in one place, because two tables draw it: the list and the
 * skeleton that stands in for it while the rows are on their way. A column
 * added to one and not the other is a screen that jumps when the data lands,
 * which is exactly what the skeleton exists to prevent.
 */
function ValidationsHead({ showCashier }: { showCashier: boolean }) {
  return (
    <thead>
      <tr>
        {/* No heading: the column is one glyph wide and its meaning is under
            the pointer. The word still reaches a screen reader, from the mark's
            own aria-label. */}
        <th className="w-5" />
        <th>Control</th>
        {/* Not "Hora": the cell holds an hour only while the row is today's,
            and a date once it is not — see `formatValidatedAt`. */}
        <th>Validado</th>
        <th>Referencia</th>
        <th className="text-right">Monto (Bs)</th>
        <th>Teléfono</th>
        {/* The payer's side, then the shop's, in the order the receipt reads
            and the modal lists them — two banks side by side, which is the only
            way "de dónde vino" is a comparison and not two lookups. "Banco"
            alone was the receiving one, and a table that names one bank on a
            payment between two says which. */}
        <th>Banco emisor</th>
        <th>Banco receptor</th>
        {showCashier && <th>Cajero</th>}
      </tr>
    </thead>
  );
}

/**
 * The same list, before it has anything to list.
 *
 * It is the real markup with a plausible row in it, wearing `.sk-mask` — every
 * cell's ink becomes a bar and the columns land where the data will, because
 * the widths are measured from a control code and a reference rather than from
 * numbers somebody picked to look right. `aria-hidden`, since what is under the
 * bars is furniture: a screen reader announcing six invented references would
 * be worse than the silence.
 */
const SKELETON_ROWS = ['a', 'b', 'c', 'd', 'e', 'f'];

/** A card on a phone is three lines in a 12px box — see the list above. */
const SKELETON_CARD_HEIGHT = 84;

export function ValidationListSkeleton({ showCashier = false }: { showCashier?: boolean }) {
  return (
    <div className="sk-mask" aria-hidden="true">
      <Card className="hidden overflow-x-auto p-0 min-[900px]:block">
        <table className="table">
          <ValidationsHead showCashier={showCashier} />
          <tbody>
            {SKELETON_ROWS.map((row) => (
              <tr key={row}>
                <td className="pr-0">•</td>
                <td className="font-heading tabular-nums">582422</td>
                <td className="whitespace-nowrap">10:24</td>
                <td className="tabular-nums">12346090431</td>
                <td className="text-right font-heading tabular-nums">630,00</td>
                <td className="tabular-nums">0414-3125566</td>
                <td className="whitespace-nowrap">Banesco</td>
                <td className="whitespace-nowrap">Banesco · Caja</td>
                {showCashier && <td className="whitespace-nowrap">María Rodríguez</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="min-[900px]:hidden">
        <SkeletonCards count={SKELETON_ROWS.length} height={SKELETON_CARD_HEIGHT} />
      </div>
    </div>
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
