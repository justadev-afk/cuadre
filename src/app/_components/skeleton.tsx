/**
 * Loading placeholders.
 *
 * The one rule that matters: **a skeleton is the same height as the content it
 * stands in for** — a 38px table row, a 52px card — so nothing jumps when the
 * data lands. The design fixes those numbers; they are constants here rather
 * than props with defaults, because a caller that picks its own height is how
 * the layout starts shifting again.
 */

/** A table row in the design is 38px tall; a list card, 52px. */
export const SKELETON_ROW_HEIGHT = 38;
export const SKELETON_CARD_HEIGHT = 52;

/** Staggered so the block reads as loading rather than as a broken gradient. */
function delayFor(index: number): string {
  return `${(index * 0.09).toFixed(2)}s`;
}

export function SkeletonLine({ width = '100%', height = 11 }: { width?: string; height?: number }) {
  return <div className="sk" style={{ width, height }} />;
}

export function SkeletonCards({ count = 3, height = SKELETON_CARD_HEIGHT }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {Array.from({ length: count }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a placeholder's only identity is its position; the list never reorders, it is replaced wholesale.
          key={i}
          className="sk"
          style={{
            height,
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)',
            boxShadow: 'var(--shadow-sm)',
            animationDelay: delayFor(i),
          }}
        />
      ))}
    </div>
  );
}

/**
 * The validations table mid-load. `columns` are relative widths so the
 * skeleton lines up with the real header that replaces it.
 */
export function SkeletonTable({
  columns = ['1.4fr', '1fr', '1fr', '1fr', '0.8fr'],
  rows = 6,
}: {
  columns?: readonly string[];
  rows?: number;
}) {
  const grid = {
    display: 'grid',
    gridTemplateColumns: columns.join(' '),
    gap: 14,
  } as const;

  const rule =
    'linear-gradient(to right, transparent, color-mix(in srgb, var(--color-text) 8%, transparent) 48px, color-mix(in srgb, var(--color-text) 8%, transparent) calc(100% - 48px), transparent) no-repeat bottom / 100% 1px';

  return (
    <div>
      <div style={{ ...grid, paddingBottom: 10, marginBottom: 6, background: rule }}>
        {columns.map((column, i) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: column widths repeat ('1fr','1fr'); position is the only stable identity and this grid never reorders.
            key={`${column}-${i}`}
            style={{ height: 9, borderRadius: 4, background: 'var(--color-neutral-800)' }}
          />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows, identity is position; replaced wholesale by the real rows.
          key={row}
          style={{ ...grid, alignItems: 'center', height: SKELETON_ROW_HEIGHT, background: rule }}
        >
          {columns.map((column, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: repeating column widths — position is the identity.
              key={`${column}-${i}`}
              className="sk"
              style={{
                height: 11,
                width: `${[100, 70, 60, 80, 66][i % 5]}%`,
                animationDelay: delayFor(row),
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** "Consultando a Banesco" — the one the cashier watches. */
export function BankSpinner({ size = 60 }: { size?: number }) {
  return <div className="spinner" style={{ width: size, height: size }} />;
}
