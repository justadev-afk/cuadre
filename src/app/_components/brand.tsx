/**
 * The brand mark: an accent-outlined rounded square holding the check icon,
 * with the wordmark beside it.
 *
 * The design repeats this at three sizes (26px in the page header, 24px on the
 * auth screens, 16-ish in the nav bar) and the admin area swaps the accent for
 * neutral and the icon for a shield — the platform team's own login is not the
 * merchant's product, and looking slightly different is the point.
 */
import { cn } from '@/lib/utils.ts';
import { Icon } from './icon.tsx';

type BrandProps = {
  /** Side of the square, px. The wordmark scales from it. */
  size?: number;
  /** The internal admin variant: neutral instead of accent, shield instead of check. */
  internal?: boolean;
  /** Mark only, no wordmark. */
  markOnly?: boolean;
};

export function Brand({ size = 24, internal = false, markOnly = false }: BrandProps) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        className={cn(
          'grid place-items-center rounded-[7px] border',
          internal
            ? 'border-[var(--color-neutral-500)] text-[var(--color-neutral-300)]'
            : 'border-primary text-primary',
        )}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.58) }}
      >
        <Icon name={internal ? 'shield-check' : 'check-square-offset'} />
      </span>
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
