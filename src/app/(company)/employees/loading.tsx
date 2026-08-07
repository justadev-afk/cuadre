import { SkeletonTable } from '../../_components/skeleton.tsx';

export default function Loading() {
  return (
    <main style={{ padding: '26px 24px', maxWidth: 760, marginInline: 'auto', width: '100%' }}>
      <h4 style={{ margin: '0 0 18px' }}>Empleados</h4>
      <SkeletonTable columns={['1.4fr', '1fr', '0.8fr', '1fr', '0.5fr']} rows={5} />
    </main>
  );
}
