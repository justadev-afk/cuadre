/**
 * The company panel's in-shell wait — the same rule as the cashier's: the shell
 * is already on screen and stays there, so a screen change waits in the content
 * area rather than behind the root splash. A screen that can show the *shape* of
 * what is coming (the validations table) keeps its own closer `loading.tsx`.
 */
import { BankSpinner } from '../_components/skeleton.tsx';

export default function Loading() {
  return (
    <div className="grid flex-1 place-items-center py-20">
      <BankSpinner size={26} />
    </div>
  );
}
