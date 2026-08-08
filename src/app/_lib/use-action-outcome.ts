'use client';

/**
 * What every dialog does with a server action's answer: close on success, toast
 * on refusal. It was four hand-written copies of the same two effects, and the
 * copies were only correct by accident — each depended on `[state.ok]` rather
 * than the callback, which is what keeps a fresh `onSuccess` closure from
 * re-firing the effect on every render (a `setState` inside it would loop). That
 * reasoning now lives here once, behind a ref, instead of in four places where
 * the next person could reasonably "fix" the dependency array.
 *
 * The refusal effect depends on the whole `state` on purpose: submitting the
 * same bad input twice must toast twice, and `[state.error]` would swallow the
 * second one because the string did not change.
 */
import { useEffect, useRef } from 'react';

import type { ActionState } from './action-state.ts';
import { toast } from './toast.ts';

export function useActionOutcome(state: ActionState, onSuccess: () => void): void {
  const latest = useRef(onSuccess);
  useEffect(() => {
    latest.current = onSuccess;
  });

  useEffect(() => {
    if (state.ok) latest.current();
  }, [state.ok]);

  useEffect(() => {
    if (state.error) toast(state.error);
  }, [state]);
}
