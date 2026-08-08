'use client';

/**
 * Sends a *browser* visitor off the express till and on to the shell `/checkout`
 * — and shows a loading screen while it does, so the swap is a clean cover, not
 * a flash of the wrong surface.
 *
 * The counter has one screen and two surfaces: `/checkout-express`, the
 * sidebar-less window the installed PWA lives in, and `/checkout`, the shell a
 * browser tab shows. Everyone lands on the express till first (the server cannot
 * tell a PWA from a tab — `display-mode: standalone` is a client fact), and this
 * keeps the PWA there while forwarding a browser tab to the shell.
 *
 * Doing it in *this* direction is deliberate: `PwaResizer` only resizes the
 * window when standalone, so a browser's express→shell hop resizes nothing — the
 * loading screen covers a plain content swap. The reverse (routing the PWA
 * through the shell) would resize the window twice, to the panel and back, which
 * no overlay can hide.
 *
 * `replace`, not `push`: the shell is a rewrite of where the tab was headed, not
 * a step to come back to.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { BankSpinner } from './skeleton.tsx';

export function ExpressBrowserGate({ to }: { to: string }) {
  const router = useRouter();
  // Default to *not* leaving, so the PWA (the common case) paints the till with
  // no loading flash; only a confirmed browser tab flips this and is covered.
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      // iOS Safari predates the display-mode media query for home-screen apps.
      (window.navigator as { standalone?: boolean }).standalone === true;
    if (!standalone) {
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
