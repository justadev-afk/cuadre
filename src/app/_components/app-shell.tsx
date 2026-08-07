'use client';

/**
 * The v2 application shell: a left sidebar and a content column, the same frame
 * for every signed-in role. Only the nav table (`ShellModel`) and the content
 * (`children`) change between admin, company and cashier.
 *
 * A client component for one reason — it marks the active nav item from the
 * path — which is exactly what lets it live in a layout: the shell renders once
 * and stays put while the page below it streams in behind a skeleton, instead
 * of the whole chrome blinking on every navigation and every load.
 *
 * On a phone the rail folds away: a top bar carries the brand and role, and a
 * bottom tab bar carries the same links.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import type { ShellModel } from '../_lib/shell-nav.ts';
import { Icon } from './icon.tsx';

/** A link is current when the path is it or sits below it. */
function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ model, children }: { model: ShellModel; children: React.ReactNode }) {
  const pathname = usePathname();
  const home = model.groups[0]?.items[0]?.href ?? '/';
  const flatItems = model.groups.flatMap((group) => group.items);

  return (
    <div className="shell">
      <aside className="shell-sidebar">
        <Link href={home} className="side-brand">
          <span className="brand-mark" style={{ width: 24, height: 24, fontSize: 14 }}>
            <Icon name="check-square-offset" />
          </span>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 16 }}>Cuadre</span>
          {model.isAdmin && (
            <span className="tag tag-neutral" style={{ fontSize: 10, marginLeft: 'auto' }}>
              Admin
            </span>
          )}
        </Link>

        {model.switcher && (
          <div className="side-switcher">
            <span className="side-switcher-mark">{model.switcher.mark}</span>
            <span style={{ flex: 1, overflow: 'hidden' }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {model.switcher.name}
              </span>
              <span className="text-muted" style={{ fontSize: 10 }}>
                {model.switcher.code}
              </span>
            </span>
          </div>
        )}

        {model.groups.map((group) => (
          <div className="side-group" key={group.label}>
            <span className="side-group-label">{group.label}</span>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="side-nav-item"
                aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            ))}
          </div>
        ))}

        <div className="side-foot">
          <div className="side-user">
            <span
              className="avatar"
              style={{ width: 28, height: 28, fontSize: 12 }}
              aria-hidden="true"
            >
              {model.user.mark}
            </span>
            <span style={{ flex: 1, overflow: 'hidden' }}>
              <span style={{ display: 'block', fontSize: 12, whiteSpace: 'nowrap' }}>
                {model.user.name}
              </span>
              <span className="text-muted" style={{ fontSize: 11 }}>
                {model.user.sub}
              </span>
            </span>
            <form action="/logout" method="post" className="side-user-out">
              <button
                type="submit"
                aria-label="Cerrar sesión"
                style={{
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  color: 'inherit',
                  padding: 0,
                  display: 'inline-flex',
                }}
              >
                <Icon name="sign-out" />
              </button>
            </form>
          </div>
        </div>
      </aside>

      <div className="shell-content">
        {/* Mobile top bar: the rail is a bottom tab bar below, so this only
            orients — brand, role. */}
        <div className="shell-topbar">
          <span className="brand-mark" style={{ width: 24, height: 24, fontSize: 14 }}>
            <Icon name="check-square-offset" />
          </span>
          <span style={{ fontFamily: 'var(--font-heading)', fontSize: 16 }}>
            {model.switcher?.name ?? 'Cuadre'}
          </span>
          <span className="tag tag-accent" style={{ fontSize: 10, marginLeft: 'auto' }}>
            {model.roleLabel}
          </span>
          <form action="/logout" method="post" style={{ display: 'inline-flex' }}>
            <button type="submit" className="btn btn-ghost btn-icon" aria-label="Cerrar sesión">
              <Icon name="sign-out" />
            </button>
          </form>
        </div>

        {children}

        <nav className="shell-mobilebar">
          {flatItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
