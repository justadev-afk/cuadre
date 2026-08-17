/**
 * "¿Sigues en caja?" — the four-hour shift prompt (screen 05).
 *
 * It blocks the screen and it does not log anybody out. Four hours after the
 * last acknowledgement the app asks who is holding the till, because a
 * validation has to stay attributable to the person who ran it; if nobody
 * answers, the session stays open and the prompt stays up. That is deliberate:
 * throwing a cashier out mid-sale is worse than the risk it avoids.
 *
 * No script, on purpose — so this stays a plain server-rendered overlay rather
 * than a Radix dialog. Both answers are `<form method="post">` submissions to a
 * route handler that answers a redirect (the `Button` is hookless, safe in a
 * Server Component), so a failed hydration bundle cannot leave a till stuck
 * behind a modal it cannot dismiss.
 *
 * Currently switched off: `SHIFT_CONFIRMATION_ENABLED` in `domain/shift.ts` is
 * `false`, so `needsShiftConfirmation` never answers true and nothing renders
 * this. Everything below is kept whole and tested for the day it is flipped
 * back on.
 */
import { Button } from '@/components/ui/button.tsx';
import { API } from '../_lib/endpoints.ts';
import { formatTime, initialsOf } from '../_lib/venezuela-format.ts';
import { Icon } from './icon.tsx';

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
  const who = [username, where].filter(Boolean).join(' · ');

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[color-mix(in_srgb,var(--color-neutral-900)_50%,transparent)] p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="¿Sigues en caja?"
        className="flex w-[min(480px,100%)] flex-col gap-6 rounded-xl border border-border bg-card p-8 text-card-foreground shadow-[var(--shadow-lg)]"
      >
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-full bg-primary/[0.12] text-xl text-primary">
            <Icon name="clock-user" />
          </span>
          <div>
            <div className="font-heading text-[19px] font-medium leading-tight">
              ¿Sigues en caja?
            </div>
            <span className="text-xs text-muted-foreground">
              Han pasado 4 horas desde que se abrió la sesión
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-md bg-sidebar px-3.5 py-3">
          <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-[var(--color-accent-800)] font-heading text-sm text-[var(--color-accent-100)]">
            {initialsOf(name)}
          </span>
          <div className="flex-1">
            <div className="font-heading text-[15px]">{name}</div>
            <span className="text-xs text-muted-foreground">
              {who === ''
                ? `desde las ${formatTime(since)}`
                : `${who} · desde las ${formatTime(since)}`}
            </span>
          </div>
        </div>

        <p className="m-0 text-sm text-foreground/85">
          Si hubo cambio de turno, cierra la sesión para que los próximos cobros queden a nombre de
          quien atiende.
        </p>

        <div className="flex gap-2">
          <form action="/logout" method="post" className="flex-1">
            <Button asChild variant="secondary" size="block" className="h-11">
              <button type="submit">Cerrar sesión</button>
            </Button>
          </form>
          <form action={API.shiftAck} method="post" className="flex-1">
            <Button asChild size="block" className="h-11">
              <button type="submit">Sigo yo, continuar</button>
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
