/**
 * The counter's two screens, in the order the header shows them.
 *
 * It lives beside the layout rather than inside it because a `layout.tsx` may
 * only export what the router knows about, and both pages need this list to
 * hand to `AppNav` along with which of the two they are.
 */
import type { NavLink } from '../../_components/app-nav.tsx';

export const CASHIER_LINKS: readonly NavLink[] = [
  { href: '/checkout', label: 'Cobrar' },
  { href: '/my-validations', label: 'Mis validaciones' },
];

/** 'Caja 2 · maria.r' — what the header shows on the right. */
export function cashierWho(name: string, username: string | null): string {
  return username === null ? name : `${name} · ${username}`;
}
