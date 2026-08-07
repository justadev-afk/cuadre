/**
 * The admin area's header links. Only "Empresas" is a real destination today;
 * a company's banks and its validations are reached *through* a company, so the
 * top-level bar carries the one screen that lists them all.
 */
import type { NavLink } from '../../_components/app-nav.tsx';

export const ADMIN_LINKS: readonly NavLink[] = [{ href: '/admin/companies', label: 'Empresas' }];
