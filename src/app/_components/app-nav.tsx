/**
 * The header bar, one per role.
 *
 * No script: the mobile menu is a native `<details>`, which opens, closes and
 * takes keyboard focus on its own. The design system's own components pages are
 * plain HTML for the same reason, and a cashier's tablet is not the place to
 * discover that a hydration bundle failed to load.
 */
import Link from 'next/link';

import { Brand } from './brand.tsx';
import { Icon } from './icon.tsx';

export type NavLink = { href: string; label: string };

type AppNavProps = {
  links: readonly NavLink[];
  /** The current path, so the active link can be marked. */
  current: string;
  /** Spanish, shown in the accent tag: "Admin" · "Empresa" · "Cajero". */
  roleLabel: string;
  /** Who is signed in — company name, or "Caja 2 · maria.r". */
  who: string;
};

export function AppNav({ links, current, roleLabel, who }: AppNavProps) {
  return (
    <header className="nav app-nav">
      <Link href={links[0]?.href ?? '/'} className="nav-brand" style={{ color: 'inherit' }}>
        <Brand size={22} />
      </Link>

      <nav className="app-nav-links">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            // `aria-current` is what the stylesheet colours, so the active
            // state is announced and painted by the same attribute.
            aria-current={isCurrent(current, link.href) ? 'page' : undefined}
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <div className="app-nav-who">
        <span className="tag tag-accent">{roleLabel}</span>
        <span className="text-muted">{who}</span>
        {/* The desktop sign-out. On a phone the same action lives in the
            <details> menu below, so this one hides at the breakpoint. */}
        <form action="/logout" method="post" className="app-nav-logout">
          <button type="submit" className="btn btn-ghost btn-icon" aria-label="Cerrar sesión">
            <Icon name="sign-out" />
          </button>
        </form>
      </div>

      <details className="app-nav-menu">
        <summary className="btn btn-ghost btn-icon" aria-label="Menú">
          <Icon name="list" />
        </summary>
        <div className="app-nav-menu-panel elev-md">
          {links.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
          <form action="/logout" method="post">
            <button type="submit" className="btn btn-ghost">
              Cerrar sesión
            </button>
          </form>
        </div>
      </details>
    </header>
  );
}

/**
 * A link is current when the path is it or sits below it. Exact-match alone
 * would unmark "Validaciones" the moment someone opened one.
 */
function isCurrent(current: string, href: string): boolean {
  return current === href || current.startsWith(`${href}/`);
}
