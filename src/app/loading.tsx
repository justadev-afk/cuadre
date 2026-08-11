/**
 * The first thing a cold start paints — the mark, the name, and a spinner.
 *
 * It sits at the root because that is the only boundary above every layout: the
 * express till resolves a session, a company and the merchant's banks before it
 * can render a single field, and on a cold Worker that is a real wait. Without
 * a boundary here the PWA opens on its background colour and nothing else, which
 * reads as an app that failed to start rather than one that is starting.
 *
 * A route with a closer `loading.tsx` — the validations table and its skeleton —
 * keeps its own: a screen that can show the *shape* of what is coming should,
 * and this splash is only for when there is no shape yet.
 */
import { Brand } from './_components/brand.tsx';
import { BankSpinner } from './_components/skeleton.tsx';

export default function Loading() {
  return (
    // h-dvh, not min-h-dvh: this is the whole window until something replaces
    // it, and the mark belongs in the middle of the window rather than at the
    // top of an empty page.
    <div className="grid h-dvh place-items-center bg-background">
      <div className="flex flex-col items-center gap-5">
        <Brand size={34} />
        <BankSpinner size={28} />
        {/* Announced, not shown: the spinner is the whole message on screen, and
            a screen reader gets the word for it. */}
        <span className="sr-only" role="status">
          Abriendo Cuadre
        </span>
      </div>
    </div>
  );
}
