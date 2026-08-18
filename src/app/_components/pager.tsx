'use client';

/**
 * Anterior · Página N · Siguiente — the one control both lists page with.
 *
 * The cashier's own list and the company panel ask the same question of the
 * same keyset cursor, so they render the same file rather than two lookalikes
 * (§11). What differs between them is state, not shape: one holds its pages in
 * a client cache and the other prefetches ahead, and neither of those is
 * anything the buttons need to know.
 *
 * It draws nothing at all on a single page. A pager under a list that has no
 * second page is furniture that says "there is more" and then refuses.
 */
import { Button } from '@/components/ui/button.tsx';
import { Icon } from './icon.tsx';

export function Pager({
  /** Zero-based; the label adds the one. */
  pageIndex,
  canPrev,
  canNext,
  onPrev,
  onNext,
  /** A page still in flight: both directions wait rather than queueing clicks. */
  busy = false,
}: {
  pageIndex: number;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  busy?: boolean;
}) {
  if (!canPrev && !canNext) return null;

  return (
    <div className="mt-3 flex items-center justify-between">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onPrev}
        disabled={!canPrev || busy}
      >
        <Icon name="arrow-left" />
        Anterior
      </Button>
      <span className="text-xs text-muted-foreground">Página {pageIndex + 1}</span>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={onNext}
        disabled={!canNext || busy}
      >
        Siguiente
        <Icon name="arrow-right" />
      </Button>
    </div>
  );
}
