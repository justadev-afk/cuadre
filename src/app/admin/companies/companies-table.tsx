'use client';

/**
 * The admin's company table, with every row a link into that company's detail.
 * A client component only for the row navigation — a `<tr>` cannot be an
 * `<a>` — so the whole row is the click target (and Enter/Space reach it), not
 * a single "ver" button hiding in the last cell.
 */
import { useRouter } from 'next/navigation';

import { Badge } from '@/components/ui/badge.tsx';
import { Icon } from '../../_components/icon.tsx';

export type CompanyRow = {
  readonly id: string;
  readonly name: string;
  readonly rif: string;
  readonly status: 'active' | 'suspended';
  readonly cashierCount: number;
  readonly recentValidationCount: number;
};

export function CompaniesTable({ companies }: { companies: readonly CompanyRow[] }) {
  const router = useRouter();

  return (
    <table className="table">
      <thead>
        <tr>
          <th>Empresa</th>
          <th>RIF</th>
          <th>Código</th>
          <th>Cajeros</th>
          <th>Validaciones (30d)</th>
          <th>Estado</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {companies.map((company) => {
          const open = () => router.push(`/admin/companies/${company.id}`);
          return (
            <tr
              key={company.id}
              tabIndex={0}
              onClick={open}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  open();
                }
              }}
              className="cursor-pointer"
            >
              <td className="font-heading">{company.name}</td>
              <td className="text-muted-foreground">{company.rif}</td>
              <td className="tabular-nums text-muted-foreground">{company.id}</td>
              <td className="tabular-nums">{company.cashierCount}</td>
              <td className="tabular-nums">{company.recentValidationCount}</td>
              <td>
                <Badge variant={company.status === 'active' ? 'accent' : 'neutral'}>
                  {company.status === 'active' ? 'Activa' : 'Suspendida'}
                </Badge>
              </td>
              <td className="text-right">
                <Icon name="caret-right" className="text-muted-foreground" />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
