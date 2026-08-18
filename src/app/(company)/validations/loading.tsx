import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { Icon } from '../../_components/icon.tsx';
import { ValidationListSkeleton } from '../../_components/validation-list.tsx';
import { StatCard } from './stat-card.tsx';

/**
 * Screen 25 — validations entering.
 *
 * What blinks is what is being fetched: the three numbers and the rows. The
 * furniture around them — the title, the two pickers, the search field, the
 * table's own headers — is *drawn*, at the size it will keep, because a
 * skeleton where a control is going to be is a screen that flickers into a
 * different screen. Everything here shares its markup with the loaded page
 * (`StatCard`, `ValidationListSkeleton`), so the columns land where the data
 * will and nothing moves when it does.
 *
 * The pickers and the button are inert copies rather than the real controls:
 * there is nothing yet to filter, and a click during the fetch would navigate
 * away from the page being waited for.
 */

/** The widths of the two `SearchableSelect`s in the header, to the pixel. */
const CONTROL = 'h-9 rounded-md border border-input bg-card';

export default function Loading() {
  return (
    <ContentLayout
      title="Validaciones"
      // Text under a bar, not a bar instead of text: the placeholder keeps the
      // line's own metrics, so the header is exactly as tall as it will be and
      // the page below it does not step up when the totals land.
      subtitle={
        <span className="sk-mask">
          <span data-sk="line" className="inline-block">
            Hoy · 0 pagos validados · Bs 0,00
          </span>
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
          <div className={`${CONTROL} w-[175px]`} />
          <div className={`${CONTROL} w-[190px]`} />
          <Button type="button" variant="secondary" tabIndex={-1} className="pointer-events-none">
            <Icon name="arrows-clockwise" />
            Actualizar
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-3 sk-mask">
        {/* Placeholder text, not empty boxes: a bar is drawn over the line the
            number will occupy, and an empty div has no line to occupy. */}
        <StatCard kicker="Cobrado hoy" value="Bs 0,00" note="0 pagos aprobados" />
        <StatCard kicker="Ticket promedio" value="Bs 0,00" note="excluye sandbox" />
        <StatCard kicker="Pagos validados" value="0" note="hoy" />
      </div>

      <div className="flex items-center gap-2" aria-hidden="true">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="magnifying-glass"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            readOnly
            tabIndex={-1}
            placeholder="Buscar por referencia, código, monto o cajero…"
            className="pointer-events-none pr-9 pl-9"
          />
        </div>
        <Button type="button" variant="secondary" tabIndex={-1} className="pointer-events-none">
          <Icon name="magnifying-glass" />
          Buscar
        </Button>
      </div>

      <ValidationListSkeleton showCashier />
    </ContentLayout>
  );
}
