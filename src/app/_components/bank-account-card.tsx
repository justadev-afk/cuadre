/**
 * A connected bank, as screens 08, 14 and 24 draw it.
 *
 * There is no account number to show any more: a connection is a bank, an
 * environment, the merchant's own name for it and the tail of the OAuth client
 * it authenticates with. A sandbox connection carries the flask badge and a
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
  /** What the merchant called this connection, when they named it. */
  label: string | null;
  /** The tail of the operate client id — all that is ever shown of it. */
  clientIdLast6: string | null;
  verifiedAt: number | null;
  /** Right-edge slot for the levers: cambiar credenciales, desactivar. */
  action?: ReactNode;
};

const BANK_NAMES: Record<string, string> = { banesco: 'Banesco' };

export function BankAccountCard(props: BankAccountCardProps) {
  const { bank, environment, status, label, clientIdLast6, verifiedAt, action } = props;
  const isSandbox = environment === 'sandbox';
  const name = BANK_NAMES[bank] ?? bank;

  // Environment, then the client tail, then the date — each only when there is
  // something to say, so a connection with no verification date does not render
  // a dangling separator.
  const caption = [
    isSandbox ? 'Pruebas' : 'Producción',
    clientIdLast6 === null ? null : `cliente ···${clientIdLast6}`,
    verifiedAt === null ? null : `verificado ${formatDate(verifiedAt)}`,
  ].filter((part) => part !== null);

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
          {label !== null && <span className="text-muted-foreground">· {label}</span>}
          {isSandbox && (
            <Badge variant="outline" className="text-[10px]">
              Sandbox
            </Badge>
          )}
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">{caption.join(' · ')}</span>
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
