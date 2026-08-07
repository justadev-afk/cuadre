/**
 * "¿Sigues en caja?" — the four-hour shift prompt (screen 05).
 *
 * It blocks the screen and it does not log anybody out. Four hours after the
 * last acknowledgement the app asks who is holding the till, because a
 * validation has to stay attributable to the person who ran it; if nobody
 * answers, the session stays open and the prompt stays up. That is deliberate:
 * throwing a cashier out mid-sale is worse than the risk it avoids.
 *
 * No script. Both answers are `<form>` submissions — one to a server action,
 * one to the sign-out route the header already posts to — so a failed hydration
 * bundle cannot leave a till stuck behind a modal it cannot dismiss.
 */
import { formatTime, initialsOf } from '../_lib/venezuela-format.ts';
import { Icon } from './icon.tsx';
import { acknowledgeShiftAction } from './shift-dialog.actions.ts';

type ShiftDialogProps = {
  /** The person the session says is here. */
  name: string;
  /** A cashier's username; null for the roles that sign in with an email. */
  username: string | null;
  /** When the session was opened, epoch seconds. */
  since: number;
  /** 'Caja 2' and the like — whatever the area wants beside the username. */
  where?: string;
};

export function ShiftDialog({ name, username, since, where }: ShiftDialogProps) {
  const who = [username, where].filter((part) => part !== null && part !== '').join(' · ');

  return (
    <div className="dialog-backdrop">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="¿Sigues en caja?"
        className="dialog elev-lg"
        style={{ width: 'min(480px, 100%)', gap: 'var(--space-6)', padding: 'var(--space-8)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            className="brand-mark"
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              fontSize: 20,
              background: 'color-mix(in srgb, var(--color-accent) 12%, transparent)',
            }}
          >
            <Icon name="clock-user" />
          </span>
          <div>
            <div className="dialog-title" style={{ fontSize: 19 }}>
              ¿Sigues en caja?
            </div>
            <span className="text-muted" style={{ fontSize: 12 }}>
              Han pasado 4 horas desde que se abrió la sesión
            </span>
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-neutral-900)',
          }}
        >
          <span className="avatar" style={{ width: 38, height: 38, fontSize: 14 }}>
            {initialsOf(name)}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>{name}</div>
            <span className="text-muted" style={{ fontSize: 12 }}>
              {who === ''
                ? `desde las ${formatTime(since)}`
                : `${who} · desde las ${formatTime(since)}`}
            </span>
          </div>
        </div>

        <p className="dialog-body" style={{ margin: 0 }}>
          Si hubo cambio de turno, cierra la sesión para que los próximos cobros queden a nombre de
          quien atiende.
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          <form action="/logout" method="post" style={{ flex: 1 }}>
            <button type="submit" className="btn btn-secondary btn-block" style={{ minHeight: 44 }}>
              Cerrar sesión
            </button>
          </form>
          <form action={acknowledgeShiftAction} style={{ flex: 1 }}>
            <button type="submit" className="btn btn-primary btn-block" style={{ minHeight: 44 }}>
              Sigo yo, continuar
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
