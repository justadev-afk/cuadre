/**
 * What the till shows when the company has no account connected yet. The
 * cashier cannot fix it — their company does — so the copy points there rather
 * than offering an action that would 403.
 */
import { Icon } from '../../_components/icon.tsx';

export function NoBankAccount() {
  return (
    <main className="grid place-items-center px-5 py-16">
      <div className="flex max-w-[380px] flex-col items-center gap-2.5 rounded-md bg-card p-7 text-center shadow-[var(--shadow-sm)]">
        <span className="grid size-11 place-items-center rounded-full bg-sidebar text-[22px] text-muted-foreground">
          <Icon name="bank" />
        </span>
        <div className="font-heading text-base">Esta tienda todavía no tiene banco</div>
        <span className="text-[13px] text-muted-foreground">
          Avisa a quien administra el negocio para que conecte una cuenta en Bancos. Sin eso no
          podemos consultar a Banesco.
        </span>
      </div>
    </main>
  );
}
