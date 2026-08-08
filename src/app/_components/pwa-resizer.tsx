'use client';

/**
 * Best-effort PWA window sizing.
 *
 * Only an *installed* PWA can resize its own window — `window.resizeTo` is a
 * no-op (or throws) in an ordinary browser tab, by design. So this is guarded on
 * `display-mode: standalone` and fails quietly everywhere else: the counter gets
 * a compact till, the panels get room, and a tab is left exactly as it is.
 *
 * Rendered near the top of a layout; it draws nothing.
 */
import { useEffect } from 'react';

import { PWA_RESIZE_ENABLED } from '../_lib/flags.ts';

/**
 * The fixed window shape for each surface. One layout owns each, so the size
 * changes only when the screen does (login → express → panel), never within a
 * screen. Clamped to the user's screen at run time, so a small display just gets
 * a smaller window rather than one running off the edge.
 */
export const PWA_SIZE = {
  /** The cashier's till — small, focused, still wide enough for the two panes. */
  express: { width: 920, height: 760 },
  /** The full app (admin / company) — room for the sidebar and a table. */
  panel: { width: 1280, height: 900 },
  /** A single centred card. */
  login: { width: 480, height: 760 },
} as const;

/** Slack left around the window so it never quite fills (or overflows) the screen. */
const SCREEN_MARGIN_X = 40;
const SCREEN_MARGIN_Y = 80;

export function PwaResizer({ width, height }: { width: number; height: number }) {
  useEffect(() => {
    if (!PWA_RESIZE_ENABLED) return;
    if (!window.matchMedia('(display-mode: standalone)').matches) return;

    // Never ask for more than the screen holds — shrink to fit a small display.
    const targetWidth = Math.min(width, window.screen.availWidth - SCREEN_MARGIN_X);
    const targetHeight = Math.min(height, window.screen.availHeight - SCREEN_MARGIN_Y);

    try {
      window.resizeTo(Math.max(360, targetWidth), Math.max(480, targetHeight));
    } catch {
      // The browsers that refuse are exactly the ones this guard expects to.
    }
  }, [width, height]);

  return null;
}
