import { Card } from '@/components/ui/card.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { SkeletonTable } from '../../_components/skeleton.tsx';

export default function Loading() {
  return (
    <ContentLayout title="Empleados">
      <Card className="overflow-hidden p-0">
        <SkeletonTable columns={['1.4fr', '1fr', '0.8fr', '1fr', '0.5fr']} rows={5} />
      </Card>
    </ContentLayout>
  );
}
