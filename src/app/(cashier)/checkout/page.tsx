/**
 * Screen 15 — the till, inside the app shell (a browser tab's surface). The
 * installed PWA opens the sidebar-less `/checkout-express` instead; both render
 * the same `CheckoutContent`, so the two surfaces never drift on account
 * resolution, the "mi turno" pane or the receipt's merchant/cashier.
 *
 * `StandaloneRedirect` is the safety net for a PWA that cold-starts here on a
 * stale cached manifest: it forwards a standalone app on to the express till and
 * leaves a browser tab untouched. The `(cashier)` shell sizes its window to the
 * express size, so that hop does not resize twice.
 *
 * **Only for a cashier.** A company owner reaches this till too, and for them the
 * express window is a one-way door out of their own panel (`usesExpressTill`) —
 * so the forwarder is not rendered at all rather than mounted and told to stay
 * put. It is also what keeps the pair from looping: `/checkout-express` sends an
 * owner here, and here must not send them back.
 *
 * Production wins when a company holds both a production and a sandbox account;
 * the sandbox one only answers a till when it is the only one connected.
 */
import { usesExpressTill } from '../../../application/session.ts';
import { StandaloneRedirect } from '../../_components/standalone-redirect.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { pageMeta } from '../../_lib/page-meta.ts';
import { CheckoutContent } from './checkout-content.tsx';

export const metadata = pageMeta('Cobrar');

export default async function CheckoutPage() {
  // The layout's guard again, off the same cached resolve — a page and its
  // layout render together, so this costs no second KV read.
  const { session } = await requireArea('counter');

  return (
    <>
      {usesExpressTill(session.role) && <StandaloneRedirect to="/checkout-express" />}
      <CheckoutContent />
    </>
  );
}
