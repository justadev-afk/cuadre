import type { ReactNode } from 'react';

import { cn } from '@/lib/utils.ts';

/**
 * The one frame every screen's content sits in, so navigating between screens
 * never resizes the column and every title lands in the same place.
 *
 *   ┌ content ─────────────────────────────────┐
 *   │ title            (actions)   │            │
 *   │ subtitle                     │  aside?    │
 *   │ ┌ box ─────────────────────┐ │ (optional) │
 *   │ │  children                │ │            │
 *   │ └──────────────────────────┘ │            │
 *   └───────────────────────────────────────────┘
 *
 * The title is left-aligned; the body is one or more `Card` sections; the right
 * `aside` is optional — the counter uses it for "mi turno", most screens leave
 * it out. It is a two-row grid: the header row (main title, aside title) over
 * the body row (content, aside), so the two titles sit level. Below 900px the
 * aside drops under the body and its title is hidden.
 */
type ContentLayoutProps = {
  title: ReactNode;
  /** A line under the title — the "pide al cliente…" kind of instruction. */
  subtitle?: ReactNode;
  /** Header-right slot: a primary action button, a tab strip, a filter. */
  actions?: ReactNode;
  /** The optional right column. When present the layout becomes two columns. */
  aside?: ReactNode;
  /** The aside's title, rendered level with the main title (e.g. "Mi turno"). */
  asideTitle?: ReactNode;
  /**
   * Stretch the body row to the bottom of the frame and close the extra bottom
   * padding so the boxes end a margin above the edge equal to the side margin —
   * the express till fills its whole PWA window this way. Off by default: normal
   * screens size to their content and scroll.
   */
  fill?: boolean;
  children: ReactNode;
};

const heading = 'm-0 font-heading text-[21px] font-medium leading-tight tracking-[-0.01em]';

export function ContentLayout({
  title,
  subtitle,
  actions,
  aside,
  asideTitle,
  fill = false,
  children,
}: ContentLayoutProps) {
  return (
    <main
      className={cn(
        'grid w-full max-w-[1040px] gap-x-6 gap-y-[18px] px-7 pt-[26px] max-[899px]:px-4 max-[899px]:pt-[18px]',
        fill
          ? 'min-h-full grid-rows-[auto_minmax(0,1fr)] pb-7 max-[899px]:pb-4'
          : 'content-start pb-11 max-[899px]:pb-7',
        aside && 'min-[900px]:grid-cols-[minmax(0,1fr)_360px]',
        aside && (fill ? 'items-stretch' : 'items-start'),
      )}
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className={heading}>{title}</h1>
          {subtitle ? (
            <p className="mt-[3px] text-[13px] text-muted-foreground">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>

      {aside ? (
        <div className="max-[899px]:hidden">
          <h2 className={heading}>{asideTitle}</h2>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-col gap-4">{children}</div>

      {aside ? <aside className="self-stretch">{aside}</aside> : null}
    </main>
  );
}
