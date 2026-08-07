/**
 * The frame behind screens 01–04.
 *
 * Two shapes. `AuthShell` is the single centred column screens 03 and 04 draw —
 * the admin door and the password screens. `AuthSplit` is the merchant and
 * cashier login: its children *are* the grid items, panel then quote, because
 * the tab that switches the form also switches the sentence in the quote and
 * the two therefore have to be rendered by the same component.
 *
 * The breakpoint that drops the quote on a phone lives in `globals.css`
 * (`.auth*`), not here.
 */
import type { ReactNode } from 'react';

/** One centred 520px column, full height. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="auth auth-solo">
      <div className="auth-panel">{children}</div>
    </main>
  );
}

/** The two-column split. Children are the panel and the aside, in that order. */
export function AuthSplit({ children }: { children: ReactNode }) {
  return <main className="auth">{children}</main>;
}

/** The accent rule and the sentence under it, as the design pairs them. */
export function AuthQuote({ children }: { children: string }) {
  return (
    <>
      <div className="auth-aside-rule" />
      <p className="auth-aside-quote">{children}</p>
    </>
  );
}
