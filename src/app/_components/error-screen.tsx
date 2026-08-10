/**
 * What a crash looks like, in the product's own clothes.
 *
 * The framework's default is a bare stack trace on white — fine for a developer
 * and useless behind a counter, where the only two useful facts are "this is
 * still Cuadre" and "you can try again". So: the mark, one sentence, and the
 * button that re-runs the render that failed.
 *
 * Rendered by both error boundaries (`error.tsx` and `global-error.tsx`), which
 * is the whole reason it is a component: the two differ only in how much of the
 * document they have to rebuild around it, and a crash must not be the moment
 * two versions of a screen turn out to have drifted (§11).
 *
 * `digest` is the framework's hash of the server-side error. It is not a secret
 * and it is the only thread between what the user saw and the line in Workers
 * Logs, so it is shown — small, and labelled as something to quote, not to read.
 */
import { Button } from '@/components/ui/button.tsx';
import { Brand } from './brand.tsx';
import { Icon } from './icon.tsx';

export function ErrorScreen({
  onRetry,
  digest,
}: {
  onRetry: () => void;
  digest?: string | undefined;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-background px-5 py-16">
      <div className="flex w-[min(400px,100%)] flex-col items-center gap-3 rounded-xl bg-card p-8 text-center shadow-[var(--shadow-md)]">
        <Brand size={30} />

        <div className="mt-1.5 font-heading text-lg">Algo salió mal</div>
        <p className="m-0 text-[13px] text-muted-foreground">
          No pudimos cargar esta pantalla. Vuelve a intentarlo; si sigue pasando, cierra sesión y
          entra otra vez.
        </p>

        <Button className="mt-2 h-11 w-full text-base" onClick={onRetry}>
          <Icon name="arrows-clockwise" />
          Reintentar
        </Button>

        {digest ? (
          <span className="text-[11px] text-muted-foreground">
            Código para soporte: <span className="tabular-nums">{digest}</span>
          </span>
        ) : null}
      </div>
    </main>
  );
}
