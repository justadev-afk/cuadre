/**
 * Screen 15 — the till, inside the app shell (a browser tab's surface). The
 * installed PWA opens the sidebar-less `/checkout-express` instead; both render
 * the same `CheckoutContent`, so the two surfaces never drift on account
 * resolution, the "mi turno" pane or the receipt's merchant/cashier.
 *
 * Production wins when a company holds both a production and a sandbox account;
 * the sandbox one only answers a till when it is the only one connected.
 */
import { pageMeta } from '../../_lib/page-meta.ts';
import { CheckoutContent } from './checkout-content.tsx';

export const metadata = pageMeta('Cobrar');

export default function CheckoutPage() {
  return <CheckoutContent />;
}
