import type { ReactNode } from 'react';

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
 * The title is left-aligned; the body is one or more `.box` sections (bordered,
 * standard radius); the right `aside` is optional — the counter uses it for
 * "mi turno", most screens leave it out. Nothing here is screen-specific: it is
 * the shared skeleton, `children` is the only part that changes.
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
  children: ReactNode;
};

export function ContentLayout({
  title,
  subtitle,
  actions,
  aside,
  asideTitle,
  children,
}: ContentLayoutProps) {
  return (
    <main className={aside ? 'content content-with-aside' : 'content'}>
      <header className="content-head">
        <div className="content-heading">
          <h1 className="content-title">{title}</h1>
          {subtitle ? <p className="content-sub">{subtitle}</p> : null}
        </div>
        {actions ? <div className="content-actions">{actions}</div> : null}
      </header>

      {aside ? (
        <div className="content-aside-head">
          <h2 className="content-aside-title">{asideTitle}</h2>
        </div>
      ) : null}

      <div className="content-body">{children}</div>

      {aside ? <aside className="content-aside">{aside}</aside> : null}
    </main>
  );
}
