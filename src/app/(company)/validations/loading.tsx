import { ContentLayout } from '../../_components/content-layout.tsx';
import { SkeletonTable } from '../../_components/skeleton.tsx';

/** Screen 25 — the validations table entering with skeletons, same frame. */
export default function Loading() {
  return (
    <ContentLayout title="Validaciones">
      <div style={{ display: 'flex', gap: 12 }}>
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="sk"
            style={{
              flex: 1,
              height: 78,
              borderRadius: 'var(--radius-lg)',
              background: 'var(--color-surface)',
              border: '1px solid var(--color-divider)',
            }}
          />
        ))}
      </div>
      <section className="box" style={{ padding: 0, overflow: 'hidden' }}>
        <SkeletonTable columns={['0.8fr', '0.8fr', '1.2fr', '1fr', '1fr', '0.9fr']} rows={8} />
      </section>
    </ContentLayout>
  );
}
