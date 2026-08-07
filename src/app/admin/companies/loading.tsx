import { SkeletonTable } from '../../_components/skeleton.tsx';

export default function Loading() {
  return (
    <main style={{ padding: '28px 24px', maxWidth: 1120, marginInline: 'auto', width: '100%' }}>
      <h4 style={{ margin: '0 0 20px' }}>Empresas</h4>
      <SkeletonTable columns={['1.4fr', '1fr', '1fr', '0.7fr', '1fr', '0.8fr', '0.6fr']} rows={6} />
    </main>
  );
}
