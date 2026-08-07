/**
 * What the till shows when the company has no account connected yet. The
 * cashier cannot fix it — their company does — so the copy points there rather
 * than offering an action that would 403.
 */
import { Icon } from '../../_components/icon.tsx';

export function NoBankAccount() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', padding: '64px 20px' }}>
      <div
        className="card elev-sm"
        style={{ maxWidth: 380, textAlign: 'center', alignItems: 'center', gap: 10, padding: 28 }}
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
          <Icon name="bank" />
        </span>
        <div style={{ fontFamily: 'var(--font-heading)', fontSize: 16 }}>
          Esta tienda todavía no tiene banco
        </div>
        <span className="text-muted" style={{ fontSize: 13 }}>
          Avisa a quien administra el negocio para que conecte una cuenta en Bancos. Sin eso no
          podemos consultar a Banesco.
        </span>
      </div>
    </main>
  );
}
