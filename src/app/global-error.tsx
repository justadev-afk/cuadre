'use client';

/**
 * The last resort: an error thrown by the root layout itself, where `error.tsx`
 * cannot help because the layout that would have framed it is the thing that
 * failed.
 *
 * It therefore replaces the whole document and has to bring its own `<html>`,
 * `<body>` and stylesheet — none of the root layout's output exists at this
 * point. The icon font is deliberately *not* re-linked: it is a CDN request,
 * and this screen exists precisely for the moments when something is already
 * going wrong. A missing glyph costs an empty box; a hung stylesheet costs the
 * whole screen.
 */
import { ErrorScreen } from './_components/error-screen.tsx';
import './globals.css';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body>
        <ErrorScreen onRetry={reset} digest={error.digest} />
      </body>
    </html>
  );
}
