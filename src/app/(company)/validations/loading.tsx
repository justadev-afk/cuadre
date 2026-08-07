import { SkeletonTable } from '../../_components/skeleton.tsx';

/** Screen 25 — the validations table entering with skeletons. */
export default function Loading() {
  return (
    <main style={{ padding: '28px 24px', maxWidth: 1120, marginInline: 'auto', width: '100%' }}>
      <h4 style={{ margin: '0 0 20px' }}>Validaciones</h4>
      <div style={{ display: 'flex', gap: 12, marginBottom: 22 }}>
        <div
          className="sk"
          style={{
            flex: 1,
            height: 78,
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)',
            boxShadow: 'var(--shadow-sm)',
          }}
        />
        <div
          className="sk"
          style={{
            flex: 1,
            height: 78,
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)',
            boxShadow: 'var(--shadow-sm)',
          }}
        />
        <div
          className="sk"
          style={{
            flex: 1,
            height: 78,
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-surface)',
            boxShadow: 'var(--shadow-sm)',
          }}
        />
      </div>
      <SkeletonTable columns={['0.8fr', '0.8fr', '1.2fr', '1fr', '1fr', '0.9fr']} rows={8} />
    </main>
  );
}
