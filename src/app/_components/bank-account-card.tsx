/**
 * A connected bank account, as screens 08, 14 and 24 draw it.
 *
 * The account is only ever shown as its last four; the full number is sealed
 * and never leaves the server. A sandbox account carries the flask badge and a
 * dashed edge, so a till operator can tell at a glance whether the money on
 * screen is real — the same distinction the validation rows carry.
 */
import { formatDate } from '../_lib/venezuela-format.ts';
import { Icon } from './icon.tsx';

type BankAccountCardProps = {
  bank: string;
  environment: 'production' | 'sandbox';
  status: 'active' | 'needs_reverify' | 'removed';
  accountLast4: string;
  accountType: string | null;
  verifiedAt: number | null;
};

const BANK_NAMES: Record<string, string> = { banesco: 'Banesco' };

export function BankAccountCard(props: BankAccountCardProps) {
  const { bank, environment, status, accountLast4, verifiedAt } = props;
  const isSandbox = environment === 'sandbox';
  const name = BANK_NAMES[bank] ?? bank;

  return (
    <div
      className="card elev-sm"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 14,
        ...(isSandbox ? { border: '1px dashed var(--color-accent-700)' } : {}),
      }}
    >
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          fontSize: 18,
          background: isSandbox ? 'var(--color-neutral-900)' : 'var(--color-accent-800)',
          color: isSandbox ? 'var(--color-accent)' : 'var(--color-accent-100)',
        }}
      >
        <Icon name={isSandbox ? 'flask' : 'bank'} />
      </span>

      <div style={{ flex: 1 }}>
        <div
          className="card-title"
          style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}
        >
          {name}
          {isSandbox && (
            <span className="tag tag-outline" style={{ fontSize: 10 }}>
              Sandbox
            </span>
          )}
        </div>
        <span className="text-muted tnum" style={{ fontSize: 12 }}>
          {environment === 'production' ? 'Producción' : 'Pruebas'} · 1340 ···· ···· {accountLast4}
          {verifiedAt !== null && ` · verificado ${formatDate(verifiedAt)}`}
        </span>
      </div>

      {status === 'active' ? (
        <span className="tag tag-accent">Activo</span>
      ) : status === 'needs_reverify' ? (
        <span className="tag tag-neutral">Por re-verificar</span>
      ) : (
        <span className="tag tag-neutral">Retirado</span>
      )}
    </div>
  );
}
