/**
 * Platform-wide observability — what is going wrong at the counter, across every
 * merchant. `validations` keeps only confirmed payments, so this reads the
 * `cuadre_attempts` telemetry instead: how many attempts, how many confirmed,
 * how many *todavía no aparece* (shown, but never counted as a fault), and the
 * bank failures broken down by code, with the companies seeing the most of them.
 *
 * The window is fixed at 30 days to match the rest of the admin panel's figures.
 * When the SQL API token is absent the panel says so; it never fails the page.
 */

import { AttemptInsightsPanel } from '../../_components/attempt-insights-panel.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';

export const metadata = { title: 'Observabilidad · Cuadre' };

const WINDOW_DAYS = 30;

export default async function AdminObservabilityPage() {
  await requireArea('admin');

  const view = await container().observability.attemptInsights({ days: WINDOW_DAYS });

  return (
    <ContentLayout title="Observabilidad" subtitle="Errores de validación en la plataforma">
      <AttemptInsightsPanel view={view} scope="global" />
    </ContentLayout>
  );
}
