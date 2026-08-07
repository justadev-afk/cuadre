/**
 * The toast entry point every client component calls. It delegates to `sonner`
 * (rendered once as <Toaster/> in the root layout), mapping the tone to
 * sonner's success/info/error channels. Kept as a thin wrapper so the call
 * sites — `toast(message)`, `toast(message, 'success')` — never learned there
 * is a library underneath, and so a failed action still shows on the fixed
 * overlay rather than resizing the surface that raised it.
 *
 * Client-only: `sonner`'s `toast` touches a browser store, so a Server
 * Component must not import it.
 */
import { toast as sonnerToast } from 'sonner';

export type ToastTone = 'error' | 'success' | 'info';

export function toast(message: string, tone: ToastTone = 'error'): void {
  if (tone === 'success') sonnerToast.success(message);
  else if (tone === 'info') sonnerToast.info(message);
  else sonnerToast.error(message);
}
