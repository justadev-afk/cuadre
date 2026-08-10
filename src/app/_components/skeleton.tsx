/**
 * Loading placeholders.
 *
 * The one rule that matters: **a skeleton is the same height as the content it
 * stands in for** — a 38px table row, a 52px card — so nothing jumps when the
 * data lands. The design fixes those numbers; they are constants here rather
 * than props with defaults, because a caller that picks its own height is how
 * the layout starts shifting again.
 *
 * The blink is Nocturne's `sk` keyframe (a fast 0.85s pulse) applied as a
 * utility, so the whole page does not appear to load top-to-bottom.
 */

/** A table row in the design is 38px tall; a list card, 52px. */
export const SKELETON_ROW_HEIGHT = 38;
export const SKELETON_CARD_HEIGHT = 52;

const SK = 'animate-[sk_0.85s_ease-in-out_infinite]';

export function SkeletonLine({ width = '100%', height = 11 }: { width?: string; height?: number }) {
  return (
    <div className={`${SK} rounded-sm bg-[var(--color-neutral-800)]`} style={{ width, height }} />
  );
}

export function SkeletonCards({ count = 3, height = SKELETON_CARD_HEIGHT }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a placeholder's only identity is its position; the list never reorders, it is replaced wholesale.
          key={i}
          className={`${SK} rounded-md bg-card shadow-[var(--shadow-sm)]`}
          style={{ height }}
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
    'linear-gradient(to right, transparent, color-mix(in srgb, var(--color-text) 8%, transparent) 20px, color-mix(in srgb, var(--color-text) 8%, transparent) calc(100% - 20px), transparent) no-repeat bottom / 100% 1px';

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
              className={`${SK} rounded-sm bg-[var(--color-neutral-800)]`}
              style={{ height: 11, width: `${[100, 70, 60, 80, 66][i % 5]}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** One definition of what a spinner looks like here, at either size. */
const SPINNER =
  'animate-[spin_1s_linear_infinite] rounded-full border-2 border-[var(--color-neutral-800)] border-t-primary';

/** "Consultando a Banesco" — the one the cashier watches. */
export function BankSpinner({ size = 60 }: { size?: number }) {
  return <div className={SPINNER} style={{ width: size, height: size }} />;
}

/**
 * The same spinner at icon size, for a button that is waiting.
 *
 * It goes **in the slot the trailing icon vacates**, at exactly that icon's
 * 16px, so the label does not move by a pixel when the wait starts. A button
 * that reflows mid-tap is how a second tap lands somewhere else — and this one
 * is tapped by someone standing at a counter with a customer waiting.
 */
export function ButtonSpinner() {
  return <span aria-hidden="true" className={`${SPINNER} size-4 shrink-0`} />;
}
