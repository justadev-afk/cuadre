import { Card } from '@/components/ui/card.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { SkeletonTable } from '../../_components/skeleton.tsx';

export default function Loading() {
  return (
    <ContentLayout title="Bancos custom">
      <Card className="overflow-hidden p-0">
        <SkeletonTable columns={['1.2fr', '0.8fr', '1.2fr', '1.2fr', '0.7fr', '0.4fr']} rows={4} />
      </Card>
    </ContentLayout>
  );
}
