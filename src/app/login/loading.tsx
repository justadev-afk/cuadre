/**
 * The login panel while the session resolve is in flight.
 *
 * Same blocks, same heights as the real form — the brand line, the two-tab
 * selector, two fields and the button — so nothing jumps when it lands.
 */
import { AuthSplit } from '../_components/auth-shell.tsx';
import { SkeletonLine } from '../_components/skeleton.tsx';

export default function LoginLoading() {
  return (
    <AuthSplit>
      <div className="auth-panel">
        <div className="auth-top">
          <SkeletonLine width="110px" height={24} />
        </div>
        <SkeletonLine width="120px" height={25} />
        <div style={{ height: 18 }} />
        <div className="sk" style={{ height: 34, borderRadius: 'var(--radius-md)' }} />
        <div style={{ height: 18 }} />
        <div className="auth-fields">
          <div className="sk" style={{ height: 58, borderRadius: 'var(--radius-md)' }} />
          <div className="sk" style={{ height: 58, borderRadius: 'var(--radius-md)' }} />
        </div>
        <div style={{ height: 36 }} />
        <div className="sk" style={{ height: 40, borderRadius: 'var(--radius-md)' }} />
      </div>
      <aside className="auth-aside" />
    </AuthSplit>
  );
}
