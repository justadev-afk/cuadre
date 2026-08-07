import { Card } from '@/components/ui/card.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { SkeletonTable } from '../../_components/skeleton.tsx';

export default function Loading() {
  return (
    <ContentLayout title="Empresas">
      <Card className="overflow-hidden p-0">
        <SkeletonTable
          columns={['1.4fr', '1fr', '1fr', '0.7fr', '1fr', '0.8fr', '0.6fr']}
          rows={6}
        />
      </Card>
    </ContentLayout>
  );
}
