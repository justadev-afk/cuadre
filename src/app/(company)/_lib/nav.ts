/**
 * The company area's header links, in the order the design shows them.
 */
import type { NavLink } from '../../_components/app-nav.tsx';

export const COMPANY_LINKS: readonly NavLink[] = [
  { href: '/validations', label: 'Validaciones' },
  { href: '/employees', label: 'Empleados' },
  { href: '/banks', label: 'Bancos' },
  // A company owner can also work the counter — the same till a cashier uses.
  { href: '/checkout', label: 'Cobrar' },
];
