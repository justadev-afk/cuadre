/**
 * A connected bank account, as screens 08, 14 and 24 draw it.
 *
 * The account is only ever shown as its last four; the full number is sealed
 * and never leaves the server. A sandbox account carries the flask badge and a
 * dashed edge, so a till operator can tell at a glance whether the money on
 * screen is real — the same distinction the validation rows carry.
 */
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge.tsx';
import { cn } from '@/lib/utils.ts';
import { formatDate } from '../_lib/venezuela-format.ts';
import { Icon } from './icon.tsx';

type BankAccountCardProps = {
  bank: string;
  environment: 'production' | 'sandbox';
  status: 'active' | 'needs_reverify' | 'removed';
  accountLast4: string;
  accountType: string | null;
  verifiedAt: number | null;
  /** Right-edge slot for the company's one lever — the deactivate control. */
  action?: ReactNode;
};

const BANK_NAMES: Record<string, string> = { banesco: 'Banesco' };

export function BankAccountCard(props: BankAccountCardProps) {
  const { bank, environment, status, accountLast4, verifiedAt, action } = props;
  const isSandbox = environment === 'sandbox';
  const name = BANK_NAMES[bank] ?? bank;

  return (
    <div
      className={cn(
        'flex flex-row items-center gap-3.5 rounded-md bg-card p-3.5 shadow-[var(--shadow-sm)]',
        isSandbox && 'border border-dashed border-[var(--color-accent-700)]',
      )}
    >
      <span
        className={cn(
          'grid size-9 place-items-center rounded-md text-lg',
          isSandbox
            ? 'bg-sidebar text-primary'
            : 'bg-[var(--color-accent-800)] text-[var(--color-accent-100)]',
        )}
      >
        <Icon name={isSandbox ? 'flask' : 'bank'} />
      </span>

      <div className="flex-1">
        <div className="flex items-center gap-1.5 font-heading text-[15px]">
          {name}
          {isSandbox && (
            <Badge variant="outline" className="text-[10px]">
              Sandbox
            </Badge>
          )}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {environment === 'production' ? 'Producción' : 'Pruebas'} · 1340 ···· ···· {accountLast4}
          {verifiedAt !== null && ` · verificado ${formatDate(verifiedAt)}`}
        </span>
      </div>

      {status === 'active' ? (
        <Badge variant="accent">Activo</Badge>
      ) : status === 'needs_reverify' ? (
        <Badge variant="neutral">Por re-verificar</Badge>
      ) : (
        <Badge variant="neutral">Retirado</Badge>
      )}
      {action}
    </div>
  );
}
