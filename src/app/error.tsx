'use client';

/**
 * The app-wide error boundary: anything a page or its data throws lands here,
 * inside the root layout, so the shell around it is still Cuadre's.
 *
 * `reset()` re-renders the segment that failed rather than reloading the tab,
 * which is what makes *Reintentar* worth tapping: a bank call that timed out is
 * retried in place, with the session, the scroll and the typed form intact.
 */
import { ErrorScreen } from './_components/error-screen.tsx';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorScreen onRetry={reset} digest={error.digest} />;
}
