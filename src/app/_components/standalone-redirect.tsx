'use client';

/**
 * Sends an installed PWA on from the shell till to the express till — behind a
 * loading cover, so the swap reads as a clean transition rather than a flash of
 * the wrong surface.
 *
 * The counter has one screen and two surfaces: `/checkout` (the shell a browser
 * tab shows) and `/checkout-express` (the sidebar-less window the PWA lives in).
 * The manifest's `start_url` sends a fresh PWA straight to express, but an
 * *already-installed* PWA can keep an old cached manifest for a while and cold
 * start on `/checkout` instead — so this is the safety net that still lands it
 * on the express till.
 *
 * The failure mode is deliberately safe: it only *leaves* when it is sure the
 * app is standalone, so an uncertain reading keeps a browser tab exactly where
 * it is (`/checkout`, the shell it wants) rather than bouncing it away. The
 * reverse test — "leave unless standalone" — would exile a PWA to the shell the
 * moment detection lagged.
 *
 * No double-resize: the shell layout sizes its window to the express size for a
 * cashier, so this hop is size-neutral — one resize to express, or none.
 *
 * `replace`, not `push`: the express till is a rewrite of where the PWA landed,
 * not a step to come back to.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BankSpinner } from './skeleton.tsx';

export function StandaloneRedirect({ to }: { to: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari predates the display-mode media query for home-screen apps.
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (standalone) {
      setLeaving(true);
      router.replace(to);
    }
  }, [router, to]);

  if (!leaving) return null;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background">
      <BankSpinner />
    </div>
  );
}
