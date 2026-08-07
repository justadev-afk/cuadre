/**
 * The frame behind screens 01–04.
 *
 * Two shapes. `AuthShell` is the single centred column screens 03 and 04 draw —
 * the admin door and the password screens. `AuthSplit` is the merchant and
 * cashier login: its children *are* the grid items, panel then quote, because
 * the tab that switches the form also switches the sentence in the quote and
 * the two therefore have to be rendered by the same component.
 *
 * The desktop/mobile split lives in the utility classes here: a phone drops the
 * card chrome and the quote panel; a wide screen frames the login as a centred
 * card with the pitch on the right.
 */
import type { ReactNode } from 'react';

/** The panel padding shared by the split's left column and the solo column. */
export const authPanel =
  'flex min-w-0 flex-col overflow-y-auto px-[22px] py-7 md:px-11 md:pt-9 md:pb-7';

/** One centred 480px column, full height on a phone, a framed card above it. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background md:p-8">
      <div
        className={`${authPanel} max-md:min-h-dvh w-full max-md:w-full md:w-[min(480px,100%)] md:rounded-xl md:shadow-[var(--shadow-md)]`}
      >
        {children}
      </div>
    </main>
  );
}

/** The two-column split, centred in the viewport as a card. Children are the
 *  panel and the aside, in that order. */
export function AuthSplit({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background md:p-8">
      <div className="grid h-dvh w-full grid-cols-1 overflow-hidden md:h-[min(600px,calc(100dvh-64px))] md:w-[min(940px,100%)] md:grid-cols-[minmax(0,1fr)_400px] md:rounded-xl md:shadow-[var(--shadow-md)]">
        {children}
      </div>
    </main>
  );
}

/** The accent rule and the sentence under it, as the design pairs them. */
export function AuthQuote({ children }: { children: string }) {
  return (
    <>
      <div className="mt-auto h-0.5 w-[34px] shrink-0 bg-primary" />
      <p className="m-0 font-heading text-[21px] leading-[1.25]">{children}</p>
    </>
  );
}
