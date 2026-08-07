'use client';

/**
 * A full-screen stepped loading overlay for the onboarding flow.
 *
 * Verifying credentials is a single server round trip with no progress events to
 * subscribe to, so the steps here are **paced, not real** — they advance on a
 * timer and hold on the last one until the action resolves and the overlay is
 * dismissed. It exists to make a ~3s bank call feel like something is happening
 * rather than a frozen modal. It covers the whole viewport (above the dialog) so
 * nothing behind it looks clickable while the bank is being asked.
 */
import { useEffect, useState } from 'react';

import { Icon } from '../../_components/icon.tsx';

/** How long each paced step lingers before the next lights up. */
const STEP_MS = 850;

export function ConnectingOverlay({
  active,
  title,
  steps,
}: {
  active: boolean;
  title: string;
  steps: readonly string[];
}) {
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    if (!active) {
      setCurrent(0);
      return;
    }
    setCurrent(0);
    // Hold on the last step: the real work decides when we are actually done,
    // and overshooting into a "done" the server has not confirmed would lie.
    const id = setInterval(
      () => setCurrent((step) => Math.min(step + 1, steps.length - 1)),
      STEP_MS,
    );
    return () => clearInterval(id);
  }, [active, steps.length]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-background/85 p-6 backdrop-blur-sm">
      <div className="flex w-[min(90vw,360px)] flex-col gap-5 rounded-xl bg-card p-6 shadow-[var(--shadow-lg)]">
        <div className="flex items-center gap-3">
          <Icon name="arrows-clockwise" size={22} className="animate-spin text-primary" />
          <h6 className="m-0 font-heading text-[15px]">{title}</h6>
        </div>

        <ol className="flex flex-col gap-3">
          {steps.map((label, index) => {
            const state = index < current ? 'done' : index === current ? 'active' : 'pending';
            return (
              <li key={label} className="flex items-center gap-2.5 text-sm">
                <StepDot state={state} />
                <span
                  className={
                    state === 'pending'
                      ? 'text-muted-foreground'
                      : state === 'active'
                        ? 'text-foreground'
                        : 'text-muted-foreground line-through decoration-[var(--color-accent-600)]'
                  }
                >
                  {label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

function StepDot({ state }: { state: 'done' | 'active' | 'pending' }) {
  if (state === 'done') {
    return (
      <span className="grid size-5 flex-none place-items-center rounded-full bg-[var(--color-accent-800)] text-[var(--color-accent-100)]">
        <Icon name="check" size={12} />
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="size-5 flex-none rounded-full border-2 border-primary shadow-[inset_0_0_0_3px_var(--color-surface)]">
        <span className="block size-full animate-ping rounded-full bg-primary/40" />
      </span>
    );
  }
  return <span className="size-5 flex-none rounded-full border-2 border-border" />;
}
