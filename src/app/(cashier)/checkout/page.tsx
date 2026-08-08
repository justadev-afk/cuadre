/**
 * Screen 15 — the till, inside the app shell (the sidebar-less version is
 * `/checkout-express`, where a cashier lands). Both render the same
 * `CheckoutContent`: it resolves which account answers, the "mi turno" pane and
 * the receipt's merchant/cashier, so the two surfaces never drift.
 *
 * Production wins when a company holds both a production and a sandbox account;
 * the sandbox one only answers a till when it is the only one connected.
 */
import { CheckoutContent } from './checkout-content.tsx';

export const metadata = { title: 'Cobrar · Cuadre' };

export default function CheckoutPage() {
  return <CheckoutContent />;
}
