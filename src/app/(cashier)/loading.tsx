/**
 * A wait *inside* the shell, not over it.
 *
 * Without this boundary the nearest one above is the root splash, and moving
 * from the till to "mis validaciones" would blank the sidebar and the header to
 * show a logo — an app that looks like it restarted every time it is used. The
 * shell stays; only the content area waits.
 */
import { BankSpinner } from '../_components/skeleton.tsx';

export default function Loading() {
  return (
    <div className="grid flex-1 place-items-center py-20">
      <BankSpinner size={26} />
    </div>
  );
}
