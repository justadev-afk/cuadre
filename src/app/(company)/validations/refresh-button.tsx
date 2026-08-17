'use client';

/**
 * "Actualizar" — and, every thirty seconds, the same thing without being asked.
 *
 * The list is server-rendered, so keeping it current is `router.refresh()`: a
 * soft RSC re-render that swaps the rows and the day's totals while leaving the
 * client untouched — the search box keeps a half-typed term, which a reload
 * would throw away.
 *
 * It refreshes on its own because the interesting number changes somewhere
 * else: the till is validating payments while the owner watches this screen
 * from the back office. Thirty seconds is short enough that "cobrado hoy" reads
 * as live and long enough that a panel left open all day is not a poll storm —
 * two queries a minute, and only while the tab is actually being looked at. A
 * hidden tab asks nothing, and there is nothing to catch up on when it comes
 * back: `SessionHeartbeat` already refreshes on `visibilitychange` for the
 * whole shell, and doing it here too would only ask twice.
 *
 * The spin answers the *click*, never the timer — an icon that starts turning
 * by itself every thirty seconds is movement in the corner of the eye that
 * means nothing. It stops when a fresh render lands (`renderedAt` is the
 * server's clock at the top of the page, so a new value *is* new data), or at a
 * ceiling: a refresh that never comes back — a dead network, a Worker gone —
 * must not leave something spinning forever, and the button must stay clickable
 * so the merchant can simply ask again.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button.tsx';
import { Icon } from '../../_components/icon.tsx';

const AUTO_REFRESH_MS = 30_000;

/** How long the icon may keep turning with no answer from the server. */
const SPIN_CEILING_MS = 8_000;

export function RefreshButton({
  /** The server's clock at this render. A new value means new data arrived. */
  renderedAt,
}: {
  renderedAt: number;
}) {
  const router = useRouter();
  /** The render that was on screen when the button was pressed, if it was. */
  const [askedFrom, setAskedFrom] = useState<number | null>(null);

  // Derived, not stored: we are waiting exactly while the render on screen is
  // still the one we asked from. The moment a newer one arrives the prop
  // changes and the spin ends by itself — no effect has to notice.
  const asking = askedFrom !== null && askedFrom === renderedAt;

  // Except when the answer never comes: a dead network leaves the prop where it
  // was, and something that turns forever is a lie about what is happening.
  useEffect(() => {
    if (askedFrom === null) return;
    const ceiling = setTimeout(() => setAskedFrom(null), SPIN_CEILING_MS);
    return () => clearTimeout(ceiling);
  }, [askedFrom]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(timer);
  }, [router]);

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={() => {
        setAskedFrom(renderedAt);
        router.refresh();
      }}
    >
      <Icon name="arrows-clockwise" className={asking ? 'animate-spin' : undefined} />
      Actualizar
    </Button>
  );
}
