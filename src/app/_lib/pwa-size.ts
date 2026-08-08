/**
 * The fixed window shape for each surface, in a plain module — **not** a
 * `'use client'` one — on purpose: server layouts (`/login`, `/checkout-express`)
 * read these values directly, and a value imported from a client module reaches
 * a server component as a client reference, not the object, which throws at
 * render. The client `PwaResizer` reads them too; a plain module serves both.
 *
 * One layout owns each size, so the window changes only when the screen does.
 */
export const PWA_SIZE = {
  /** The cashier's till — small, focused, still wide enough for the two panes. */
  express: { width: 920, height: 760 },
  /** The full app (admin / company) — room for the sidebar and a table. */
  panel: { width: 1280, height: 900 },
  /** A single centred card. */
  login: { width: 480, height: 760 },
} as const;
