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
 * On a phone (below 900px) the rail folds away: a top bar carries the brand and
 * role, and a bottom tab bar carries the same links.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { Avatar, AvatarFallback } from '@/components/ui/avatar.tsx';
import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { cn } from '@/lib/utils.ts';
import type { ShellModel } from '../_lib/shell-nav.ts';
import { Icon } from './icon.tsx';

/** A link is current when the path is it or sits below it. */
function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The accent-outlined brand square, at the two sizes the shell draws it. */
function BrandMark() {
  return (
    <span className="grid size-6 place-items-center rounded-[7px] border border-primary text-sm text-primary">
      <Icon name="check-square-offset" />
    </span>
  );
}

export function AppShell({ model, children }: { model: ShellModel; children: React.ReactNode }) {
  const pathname = usePathname();
  const home = model.groups[0]?.items[0]?.href ?? '/';
  const flatItems = model.groups.flatMap((group) => group.items);

  return (
    <div className="grid min-h-dvh grid-cols-1 min-[900px]:grid-cols-[224px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-5 overflow-y-auto bg-sidebar px-3 py-4 shadow-[inset_-1px_0_0_var(--sidebar-border)] min-[900px]:flex">
        <Link href={home} className="flex items-center gap-2.5 px-1.5 text-inherit no-underline">
          <BrandMark />
          <span className="font-heading text-base">Cuadre</span>
          {model.isAdmin && (
            <Badge variant="neutral" className="ml-auto text-[10px]">
              Admin
            </Badge>
          )}
        </Link>

        {model.switcher && (
          <div className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-inherit shadow-[var(--shadow-sm)]">
            <span className="grid size-6 shrink-0 place-items-center rounded-md bg-[var(--color-neutral-800)] font-heading text-[10px] text-[var(--color-neutral-200)]">
              {model.switcher.mark}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs">{model.switcher.name}</span>
              <span className="text-[10px] text-muted-foreground">{model.switcher.code}</span>
            </span>
          </div>
        )}

        {model.groups.map((group) => (
          <div className="flex flex-col gap-0.5" key={group.label}>
            <span className="px-2 pb-1.5 text-[10px] tracking-[0.1em] text-foreground/40 uppercase">
              {group.label}
            </span>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-[7px] text-[13px] text-inherit no-underline transition-colors hover:bg-foreground/[0.07]',
                  isCurrent(pathname, item.href) &&
                    'bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-primary hover:bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]',
                )}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            ))}
          </div>
        ))}

        <div className="mt-auto flex items-center gap-2.5 px-1 py-1.5">
          <Avatar className="size-7 text-xs">
            <AvatarFallback>{model.user.mark}</AvatarFallback>
          </Avatar>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs">{model.user.name}</span>
            <span className="text-[11px] text-muted-foreground">{model.user.sub}</span>
          </span>
          <form action="/logout" method="post" className="inline-flex">
            <button
              type="submit"
              aria-label="Cerrar sesión"
              className="inline-flex cursor-pointer text-foreground/50 transition-colors hover:text-primary"
            >
              <Icon name="sign-out" />
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        {/* Mobile top bar: the rail is a bottom tab bar below, so this only
            orients — brand, role. */}
        <div className="flex items-center gap-2.5 bg-sidebar px-4 py-[13px] shadow-[inset_0_-1px_0_var(--border)] min-[900px]:hidden">
          <BrandMark />
          <span className="font-heading text-base">{model.switcher?.name ?? 'Cuadre'}</span>
          <Badge variant="accent" className="ml-auto text-[10px]">
            {model.roleLabel}
          </Badge>
          <form action="/logout" method="post" className="inline-flex">
            <Button type="submit" variant="ghost" size="icon" aria-label="Cerrar sesión">
              <Icon name="sign-out" />
            </Button>
          </form>
        </div>

        {children}

        <nav className="sticky bottom-0 z-30 flex gap-1 bg-sidebar px-4 pt-2 pb-3 shadow-[inset_0_1px_0_var(--border)] min-[900px]:hidden">
          {flatItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isCurrent(pathname, item.href) ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center gap-[3px] py-1.5 text-[10px] text-foreground/55 no-underline [&_i]:text-[19px]',
                isCurrent(pathname, item.href) && 'text-primary',
              )}
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
