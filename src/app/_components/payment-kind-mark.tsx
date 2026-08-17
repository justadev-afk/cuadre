'use client';

/**
 * The one-glyph "what kind of payment was this" cell — a **P** or a **T** at the
 * head of every listing row, with the word and how it was found under the
 * pointer.
 *
 * It is one component because the same question is asked in three places (the
 * cashier's list, the company panel, the shift's últimos cobros) and a column of
 * marks that disagrees with itself is worse than no column (§11).
 */
import type { SearchMode } from '../../adapters/d1/validation.repository.ts';
import type { PaymentKind } from '../../application/ports/bank-gateway.ts';
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip.tsx';
import { formatPhoneForDisplay } from '../../domain/phone.ts';
import { kindLabel, kindMark } from '../_lib/payment-kind.ts';

/**
 * How the bank was asked, in the merchant's words. Null when the row predates
 * the column or the caller does not carry it — the kind alone still reads.
 */
function searchLine(mode: SearchMode | null): string | null {
  if (mode === 'exact_reference') return 'Encontrado por la referencia completa.';
  if (mode === 'reference_tail_and_phone') {
    return 'Encontrado por los últimos dígitos de la referencia y el teléfono.';
  }
  if (mode === 'reference_tail_and_account') {
    return 'Encontrado por los últimos dígitos de la referencia y la cuenta.';
  }
  return null;
}

export function PaymentKindMark({
  kind,
  searchMode = null,
  payerPhone = null,
}: {
  readonly kind: PaymentKind;
  readonly searchMode?: SearchMode | null;
  readonly payerPhone?: string | null;
}) {
  const search = searchLine(searchMode);

  return (
    <Tooltip>
      {/* A span, never a button: every one of these sits inside something
          already clickable — a row that re-opens the receipt. */}
      <TooltipTrigger asChild>
        <span
          // A glyph standing in for a word: read the word, not the letter.
          role="img"
          aria-label={kindLabel(kind)}
          className="grid size-5 cursor-default place-items-center rounded-[5px] bg-foreground/[0.06] font-heading text-[11px] text-muted-foreground"
        >
          {kindMark(kind)}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[30ch]">
        <span className="font-heading">{kindLabel(kind)}</span>
        {search !== null && <div className="mt-0.5 text-muted-foreground">{search}</div>}
        {payerPhone !== null && (
          <div className="mt-0.5 text-muted-foreground">
            Teléfono <span className="tabular-nums">{formatPhoneForDisplay(payerPhone)}</span>
          </div>
        )}
        {payerPhone === null && kind === 'transferencia' && (
          <div className="mt-0.5 text-muted-foreground">
            Una transferencia no lleva teléfono del pagador.
          </div>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
