'use client';

/**
 * Keeps a page that nobody is touching in step with the server.
 *
 * A till is left open for a whole shift, and a cashier walks away from it. Two
 * things then drift, because both are decided by a *server* render and an idle
 * tab never asks for one:
 *
 *  - **The 4-hour shift prompt.** `needsShiftConfirmation` is recomputed only
 *    when a layout renders (a navigation, a submit). On a tab that just sits
 *    there, the four-hour mark passes and the dialog never appears — the whole
 *    "who is at the till?" check silently stops working.
 *  - **The session's sliding TTL.** Resolving the session on the server is the
 *    keep-alive (`resolveSession` → `touch`); with no requests, nothing slides
 *    it.
 *
 * So this pings the server on a slow interval with `router.refresh()` — a soft
 * RSC refresh that re-runs the layout (surfacing the shift dialog the instant
 * the server says it is due, and sliding the TTL) while **preserving client
 * state**: a half-typed reference in the till survives the refresh untouched.
 *
 * It also refreshes the moment a hidden tab is looked at again, so someone
 * returning to a forgotten till sees the current state without waiting out an
 * interval. If the refresh finds the session gone or superseded, the layout's
 * own guard redirects — this component decides nothing, it only asks.
 *
 * Draws nothing. Mounted once per shell (`AppShell`, the express till layout),
 * so every signed-in surface has it.
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Slow on purpose. The shift prompt is a 4-hour nudge and the TTL is 30 days —
 * neither needs second precision, and a POS should not chatter at the server all
 * shift. A couple of minutes surfaces the dialog promptly enough and keeps the
 * session warm without noise.
 */
const HEARTBEAT_MS = 2 * 60 * 1000;

export function SessionHeartbeat() {
  const router = useRouter();

  useEffect(() => {
    const tick = () => router.refresh();
    const interval = setInterval(tick, HEARTBEAT_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [router]);

  return null;
}
