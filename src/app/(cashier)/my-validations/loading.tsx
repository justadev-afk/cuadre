import { SkeletonCards } from '../../_components/skeleton.tsx';

/** The list mid-load: same-height cards, so nothing jumps when they land. */
export default function Loading() {
  return (
    <main
      style={{
        padding: '20px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        maxWidth: 720,
        marginInline: 'auto',
        width: '100%',
      }}
    >
      <div>
        <h4 style={{ margin: 0 }}>Mis validaciones</h4>
      </div>
      <SkeletonCards count={6} />
    </main>
  );
}
