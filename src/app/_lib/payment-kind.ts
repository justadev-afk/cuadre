import type { PaymentKind } from '../../application/ports/bank-gateway.ts';

/**
 * How a kind reads on a receipt or a row. It is not the bank's `label` — that
 * one is the selector's, and comes from whichever bank is connected; this is the
 * word for a payment that has already happened, and it has to render for a row
 * whose bank is long gone.
 */
export function kindLabel(kind: PaymentKind): string {
  return kind === 'transferencia' ? 'Transferencia' : 'Pago móvil';
}

/**
 * The one glyph a listing has room for. A column of *P*s and *T*s is read at a
 * glance down the page; the word is what the tooltip and the receipt spell out.
 */
export function kindMark(kind: PaymentKind): string {
  return kind === 'transferencia' ? 'T' : 'P';
}
