'use client';

/**
 * A cash-register receipt for a thermal printer: ~80mm wide, monospace, black on
 * white, no colour (§10's token rule yields here — a thermal roll is monochrome
 * and must print the same in either theme, so the plain `black`/`white`
 * utilities are deliberate). "CUADRE" heads the ticket.
 *
 * It renders off-screen in the DOM and only becomes visible when the page
 * prints: the `@media print` block in `globals.css` hides everything else and
 * drops `.receipt-print-root` to the top-left of the sheet. Only one receipt is
 * ever mounted at a time (inside the open modal), so `window.print()` prints
 * exactly this ticket. `PrintReceiptButton` is the trigger.
 */
import { Button } from '@/components/ui/button.tsx';
import { formatBolivares } from '../../domain/money.ts';
import { formatPhoneForDisplay } from '../../domain/phone.ts';
import { formatDateTime } from '../_lib/venezuela-format.ts';
import { Icon } from './icon.tsx';

export type ReceiptData = {
  readonly merchantName?: string | null;
  readonly controlCode: string;
  readonly reference: string;
  readonly amountCents: number;
  readonly payerPhone: string;
  readonly bankName?: string | null;
  readonly cashierName?: string | null;
  /** Epoch seconds — the bank's transaction time. */
  readonly atSeconds: number;
  readonly isSandbox: boolean;
};

/** The print trigger. `window.print()` prints the one mounted receipt. */
export function PrintReceiptButton({ className }: { className?: string }) {
  return (
    <Button type="button" variant="secondary" className={className} onClick={() => window.print()}>
      <Icon name="printer" />
      Imprimir recibo
    </Button>
  );
}

export function ThermalReceipt({ data }: { data: ReceiptData }) {
  return (
    <div className="receipt-print-root" aria-hidden="true">
      <div className="w-full bg-white px-3 py-4 text-center font-mono text-[12px] leading-tight text-black">
        <div className="text-[20px] font-bold tracking-[0.35em]">CUADRE</div>
        {data.merchantName ? <div className="mt-0.5 text-[11px]">{data.merchantName}</div> : null}

        <Rule />
        <div className="text-[11px] font-bold">COMPROBANTE DE PAGO</div>
        <div className="text-[11px]">Pago móvil validado</div>
        <Rule />

        <div className="text-[10px] tracking-[0.2em]">CÓDIGO DE CONTROL</div>
        <div className="text-[26px] font-bold tracking-[0.15em] tabular-nums">
          {data.controlCode}
        </div>
        <Rule />

        <div className="text-left">
          <Line label="Monto" value={formatBolivares(data.amountCents)} strong />
          <Line label="Referencia" value={data.reference} />
          <Line label="Teléfono" value={formatPhoneForDisplay(data.payerPhone)} />
          {data.bankName ? <Line label="Banco" value={data.bankName} /> : null}
          {data.cashierName ? <Line label="Cajero" value={data.cashierName} /> : null}
          <Line label="Fecha" value={formatDateTime(data.atSeconds)} />
        </div>

        {data.isSandbox ? (
          <>
            <Rule />
            <div className="text-[11px] font-bold">*** PRUEBA / SANDBOX ***</div>
          </>
        ) : null}

        <Rule />
        <div className="text-[10px] leading-snug">
          Validado con Cuadre
          <br />
          Este comprobante confirma el pago; no lo cobra.
        </div>
      </div>
    </div>
  );
}

function Rule() {
  return <div className="my-2 border-black border-t border-dashed" />;
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3 py-[1px]">
      <span>{label}</span>
      <span className={`tabular-nums ${strong ? 'font-bold' : ''}`}>{value}</span>
    </div>
  );
}
