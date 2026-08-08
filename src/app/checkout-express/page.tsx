/**
 * The express till's content — the very same `CheckoutContent` `/checkout`
 * renders, so the pago-móvil form and the "mi turno" pane behave identically;
 * only the frame around it (this route's slim header, no sidebar) differs.
 */
import { CheckoutContent } from '../(cashier)/checkout/checkout-content.tsx';

export const metadata = { title: 'Caja · Cuadre' };

export default function CheckoutExpressPage() {
  return <CheckoutContent />;
}
