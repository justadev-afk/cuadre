/**
 * A tiny toast bus, module-level so any client component can raise one without
 * threading a context through the tree.
 *
 * Toasts exist so a failed action never *resizes* the surface that raised it: a
 * dialog that grows a red block when the server says no is a dialog that jumps
 * under the cursor. The message goes to a fixed overlay instead (`<Toaster/>`),
 * and the modal stays exactly the size it was.
 *
 * Client-only: it holds mutable state and schedules a timeout, so a Server
 * Component must not import it.
 */
export type ToastTone = 'error' | 'success' | 'info';
export type Toast = { readonly id: number; readonly message: string; readonly tone: ToastTone };

type Listener = (toasts: readonly Toast[]) => void;

let toasts: readonly Toast[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

/** Roughly how long a toast lingers before it dismisses itself. */
const TOAST_TTL_MS = 4500;

function emit(): void {
  for (const listener of listeners) listener(toasts);
}

export function toast(message: string, tone: ToastTone = 'error'): void {
  const id = nextId++;
  toasts = [...toasts, { id, message, tone }];
  emit();
  setTimeout(() => dismissToast(id), TOAST_TTL_MS);
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((entry) => entry.id !== id);
  emit();
}

/** Subscribe the `<Toaster/>` to the bus; returns an unsubscribe. */
export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => {
    listeners.delete(listener);
  };
}
