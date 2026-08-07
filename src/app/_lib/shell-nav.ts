/**
 * The sidebar's contents for each role.
 *
 * One shell serves every signed-in role — admin, company and cashier see the
 * same frame, and only this table changes what the left rail lists and who the
 * footer says is signed in. It carries no markup, just the data the shell
 * renders, so a server layout can build it and hand it to the client shell
 * without shipping a use case to the browser.
 */
import type { SessionRecord } from '../../application/session.ts';
import type { IconName } from '../_components/icon.tsx';
import { initialsOf } from './venezuela-format.ts';

export type ShellNavItem = {
  readonly href: string;
  readonly label: string;
  readonly icon: IconName;
};
export type ShellNavGroup = { readonly label: string; readonly items: readonly ShellNavItem[] };
export type ShellSwitcher = { readonly mark: string; readonly name: string; readonly code: string };
export type ShellUser = { readonly mark: string; readonly name: string; readonly sub: string };

export type ShellModel = {
  /** Spanish, shown in the mobile top bar tag. */
  readonly roleLabel: string;
  /** Admin shows a badge where a company shows its switcher. */
  readonly isAdmin: boolean;
  readonly switcher: ShellSwitcher | null;
  readonly groups: readonly ShellNavGroup[];
  readonly user: ShellUser;
};

const ADMIN_GROUPS: readonly ShellNavGroup[] = [
  {
    label: 'Plataforma',
    items: [
      { href: '/admin/overview', label: 'Resumen', icon: 'broadcast' },
      { href: '/admin/companies', label: 'Empresas', icon: 'buildings' },
      { href: '/admin/observability', label: 'Observabilidad', icon: 'pulse' },
    ],
  },
];

const COMPANY_GROUPS: readonly ShellNavGroup[] = [
  {
    label: 'Operación',
    items: [
      { href: '/validations', label: 'Validaciones', icon: 'list-checks' },
      { href: '/checkout', label: 'Cobrar', icon: 'cash-register' },
    ],
  },
  {
    label: 'Configuración',
    items: [
      { href: '/employees', label: 'Empleados', icon: 'users-three' },
      { href: '/banks', label: 'Bancos', icon: 'bank' },
      { href: '/profile', label: 'Ajustes', icon: 'gear-six' },
    ],
  },
];

const CASHIER_GROUPS: readonly ShellNavGroup[] = [
  {
    label: 'Caja',
    items: [
      { href: '/checkout', label: 'Cobrar', icon: 'cash-register' },
      { href: '/my-validations', label: 'Mis validaciones', icon: 'receipt' },
    ],
  },
];

export function shellModel(
  session: SessionRecord,
  company?: { readonly name: string; readonly code: string } | null,
): ShellModel {
  const user = (sub: string): ShellUser => ({
    mark: initialsOf(session.name),
    name: session.name,
    sub,
  });
  const switcher = (): ShellSwitcher | null =>
    company ? { mark: initialsOf(company.name), name: company.name, code: company.code } : null;

  switch (session.role) {
    case 'admin':
      return {
        roleLabel: 'Admin',
        isAdmin: true,
        switcher: null,
        groups: ADMIN_GROUPS,
        user: user('Equipo Cuadre'),
      };
    case 'company':
      return {
        roleLabel: 'Empresa',
        isAdmin: false,
        switcher: switcher(),
        groups: COMPANY_GROUPS,
        user: user('Empresa'),
      };
    case 'cashier':
      return {
        roleLabel: 'Cajero',
        isAdmin: false,
        switcher: switcher(),
        groups: CASHIER_GROUPS,
        user: user(session.username ? `${session.username} · Caja` : 'Cajero'),
      };
  }
}
