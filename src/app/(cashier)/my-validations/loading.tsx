import { ContentLayout } from '../../_components/content-layout.tsx';
import { SkeletonCards } from '../../_components/skeleton.tsx';

/** The list mid-load: the frame and title stay, only the cards are a skeleton. */
export default function Loading() {
  return (
    <ContentLayout title="Mis validaciones">
      <SkeletonCards count={6} />
    </ContentLayout>
  );
}
