/**
 * The statistics screen, waiting for its one batch.
 *
 * A route skeleton is allowed here, and is not on the panel next door: the only
 * controls on this screen are a dropdown and a calendar, both one-shot gestures
 * with nothing half-typed to lose when the segment is replaced (see the note at
 * the top of `page.tsx`).
 *
 * It draws the four tiles and the two plots at the heights they will land at, so
 * the page does not jump when the numbers arrive.
 */
import { Card } from '@/components/ui/card.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { SkeletonTable } from '../../_components/skeleton.tsx';
import { StatCard } from '../../_components/stat-card.tsx';

export default function Loading() {
  return (
    <ContentLayout title="Estadísticas">
      <div className="flex flex-wrap gap-3">
        <StatCard skeleton kicker="Cobrado" />
        <StatCard skeleton kicker="Ticket promedio" />
        <StatCard skeleton kicker="Promedio por día" />
        <StatCard skeleton kicker="Mejor día" />
      </div>

      <Card className="h-[214px] sk-mask">
        <span data-sk="line" className="block h-full [--sk-h:100%] [--sk-w:100%]" />
      </Card>
      <Card className="h-[214px] sk-mask">
        <span data-sk="line" className="block h-full [--sk-h:100%] [--sk-w:100%]" />
      </Card>

      <Card className="overflow-hidden p-0">
        <SkeletonTable columns={['1.4fr', '0.5fr', '0.8fr', '1.2fr']} rows={4} />
      </Card>
    </ContentLayout>
  );
}
