/**
 * The brand lockup: the real Cuadre mark beside the wordmark.
 *
 * The mark is `icon.svg` — the very artwork the PWA icon, the favicon and the
 * apple-touch icon are cut from (the tricolour tablet with the confirmation
 * check), so the logo a cashier sees in the till header is the same one on their
 * home screen. That recognition is the whole point; a drawn stand-in would not
 * carry it.
 *
 * The admin area is the one exception: its `internal` variant swaps the mark for
 * a neutral shield, because the platform team's own door is deliberately not the
 * merchant's product and should not wear the merchant's logo.
 */
import { Icon } from './icon.tsx';

type BrandProps = {
  /** Side of the mark, px. The wordmark scales from it. */
  size?: number;
  /** The internal admin variant: a neutral shield, not the product's logo. */
  internal?: boolean;
  /** Mark only, no wordmark. */
  markOnly?: boolean;
};

export function Brand({ size = 24, internal = false, markOnly = false }: BrandProps) {
  return (
    <span className="inline-flex items-center gap-2.5">
      {internal ? (
        <span
          className="grid place-items-center rounded-[7px] border border-[var(--color-neutral-500)] text-[var(--color-neutral-300)]"
          style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }}
        >
          <Icon name="shield-check" />
        </span>
      ) : (
        // The mark already carries its own rounded tile, so it needs no frame —
        // just the image at the asked size. `alt` is empty when the wordmark
        // spells the name beside it, and names the brand when it stands alone.
        <img
          src="/icons/icon.svg"
          alt={markOnly ? 'Cuadre' : ''}
          width={size}
          height={size}
          className="block shrink-0"
          style={{ width: size, height: size }}
        />
      )}
      {!markOnly && (
        <span
          className="font-heading tracking-[-0.01em]"
          style={{ fontSize: Math.round(size * 0.71) }}
        >
          Cuadre
        </span>
      )}
    </span>
  );
}
