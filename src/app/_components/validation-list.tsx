/**
 * A list of validated payments, as the cashier's "mis validaciones" and the
 * mobile view of the company panel both draw it: one card per confirmed
 * payment, the control code in the accent, the amount large.
 *
 * A row here is always a *confirmed* payment — the table has no status column
 * because the store has no unconfirmed row. The sandbox tag is the only badge,
 * and it reads the flag copied onto the row, never a join.
 */
import type { Validation } from '../../adapters/d1/validation.repository.ts';
import { formatBolivares } from '../../domain/money.ts';
import { formatDayClock } from '../_lib/venezuela-format.ts';
import { Icon } from './icon.tsx';

export function ValidationCards({
  items,
  nowSeconds,
}: {
  items: readonly Validation[];
  nowSeconds: number;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((v) => (
        <div key={v.id} className="card elev-sm" style={{ gap: 4, padding: '12px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 16 }}>
              {formatBolivares(v.amountCents)}
            </div>
            <span
              className="tnum"
              style={{
                fontFamily: 'var(--font-heading)',
                fontSize: 12,
                color: 'var(--color-accent-300)',
              }}
            >
              {v.controlCode}
            </span>
            {v.isSandbox && (
              <span className="tag tag-outline" style={{ fontSize: 10 }}>
                <Icon name="flask" style={{ marginRight: 3 }} />
                Sandbox
              </span>
            )}
          </div>
          <span className="text-muted" style={{ fontSize: 12 }}>
            {formatDayClock(v.trnAt, nowSeconds)} · ref. <span className="tnum">{v.reference}</span>{' '}
            · {v.payerPhone}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The empty state — screen 27. */
export function NoValidations({ cta }: { cta?: { href: string; label: string } }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
        padding: '34px 0',
        textAlign: 'center',
      }}
    >
      <span
        className="avatar"
        style={{
          width: 44,
          height: 44,
          background: 'var(--color-neutral-900)',
          color: 'var(--color-neutral-500)',
          fontSize: 22,
        }}
      >
        <Icon name="receipt" />
      </span>
      <div style={{ fontFamily: 'var(--font-heading)', fontSize: 16 }}>
        Todavía no validas nada hoy
      </div>
      <span className="text-muted" style={{ fontSize: 12, maxWidth: '28ch' }}>
        El primer cobro del día aparecerá aquí.
      </span>
      {cta && (
        <a href={cta.href} className="btn btn-primary" style={{ marginTop: 8 }}>
          {cta.label}
        </a>
      )}
    </div>
  );
}
