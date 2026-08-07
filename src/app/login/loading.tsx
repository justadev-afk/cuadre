/**
 * The login panel while the session resolve is in flight.
 *
 * Same blocks, same heights as the real form — the brand line, the two-tab
 * selector, two fields and the button — so nothing jumps when it lands.
 */
import { AuthSplit, authPanel } from '../_components/auth-shell.tsx';
import { SkeletonLine } from '../_components/skeleton.tsx';

const BLOCK = 'animate-[sk_0.85s_ease-in-out_infinite] rounded-md bg-[var(--color-neutral-800)]';

export default function LoginLoading() {
  return (
    <AuthSplit>
      <div className={authPanel}>
        <SkeletonLine width="110px" height={24} />
        <div className="my-auto flex w-full max-w-[360px] flex-col gap-4">
          <SkeletonLine width="120px" height={25} />
          <div className={BLOCK} style={{ height: 34 }} />
          <div className="flex flex-col gap-3">
            <div className={BLOCK} style={{ height: 58 }} />
            <div className={BLOCK} style={{ height: 58 }} />
          </div>
          <div className={BLOCK} style={{ height: 42 }} />
        </div>
      </div>
      <aside className="hidden bg-[var(--color-neutral-900)] md:block" />
    </AuthSplit>
  );
}
