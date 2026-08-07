/**
 * The attempt telemetry, rendered. A pure server component: it takes the view
 * the `observability` use case already shaped and draws it, holding no logic
 * beyond turning normalised codes into Spanish and counts into bars.
 *
 * It renders every state the view can be in — `unconfigured` (no SQL API token
 * in this environment), `error` (the query failed), and `ok` — so a missing
 * secret reads as a one-line setup note, never as a blank or broken panel.
 *
 * The failure breakdown is the point of the screen: `not_found` is shown, but
 * set apart and labelled "no es un error", because it is the honest *todavía no
 * aparece* and would otherwise drown the codes an admin is actually hunting.
 */
import Link from 'next/link';

import { Card } from '@/components/ui/card.tsx';
import type { AttemptInsightsView } from '../../application/observability/attempt-insights.ts';

/** The normalised bank codes, in the merchant-facing Spanish the admin reads. */
const FAILURE_LABEL: Record<string, string> = {
  rejected_credentials: 'Credenciales inválidas',
  no_accounts: 'Sin cuentas en el banco',
  invalid_input: 'Datos inválidos',
  maintenance: 'Banco en mantenimiento',
  unavailable: 'Banco no disponible',
  rate_limited: 'Límite de solicitudes',
  timeout: 'Tiempo de espera agotado',
  desconocido: 'Sin código',
};

type Scope = 'global' | 'company';

export function AttemptInsightsPanel({ view, scope }: { view: AttemptInsightsView; scope: Scope }) {
  if (view.status === 'unconfigured') {
    return (
      <Card>
        <p className="m-0 py-3 text-center text-sm text-muted-foreground">
          La observabilidad no está configurada. Define <Code>CF_ACCOUNT_ID</Code> y el secreto{' '}
          <Code>ANALYTICS_SQL_TOKEN</Code> para leer la telemetría de intentos.
        </p>
      </Card>
    );
  }

  if (view.status === 'error') {
    return (
      <Card>
        <p className="m-0 py-3 text-center text-sm text-muted-foreground">
          No pudimos leer la telemetría en este momento. Inténtalo de nuevo en un momento.
        </p>
      </Card>
    );
  }

  const failurePct = view.totalAttempts === 0 ? 0 : (view.bankFailures / view.totalAttempts) * 100;
  const maxFailure = view.failuresByCode.reduce((max, f) => Math.max(max, f.count), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Stat
          kicker={`Intentos (${view.windowDays}d)`}
          value={String(view.totalAttempts)}
          note="al banco"
        />
        <Stat
          kicker="Confirmados"
          value={String(view.confirmed)}
          note={share(view.confirmed, view.totalAttempts)}
        />
        <Stat kicker="Todavía no aparece" value={String(view.notFound)} note="no es un error" />
        <Stat
          kicker="Errores de banco"
          value={String(view.bankFailures)}
          note={`${failurePct.toFixed(1)}% de los intentos`}
          tone={view.bankFailures > 0 ? 'danger' : 'default'}
        />
        <Stat kicker="Latencia media" value={`${view.avgLatencyMs} ms`} note="por intento" />
      </div>

      <div>
        <h6 className="mb-2 text-primary">Errores por código</h6>
        {view.failuresByCode.length === 0 ? (
          <Card>
            <p className="m-0 py-3 text-center text-sm text-muted-foreground">
              Sin errores de banco en la ventana. Solo confirmaciones y pagos que todavía no
              aparecen.
            </p>
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Código</th>
                  <th className="text-right">Ocurrencias</th>
                  <th className="w-2/5">Frecuencia</th>
                </tr>
              </thead>
              <tbody>
                {view.failuresByCode.map((f) => (
                  <tr key={f.code}>
                    <td className="font-heading">{FAILURE_LABEL[f.code] ?? f.code}</td>
                    <td className="text-right tabular-nums">{f.count}</td>
                    <td>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-neutral-800)]">
                        <div
                          className="h-full rounded-full bg-[var(--color-danger)]"
                          style={{
                            width: `${maxFailure === 0 ? 0 : (f.count / maxFailure) * 100}%`,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {scope === 'global' && view.topFailingCompanies.length > 0 && (
        <div>
          <h6 className="mb-2 text-primary">Empresas con más errores</h6>
          <Card className="overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th className="text-right">Errores de banco</th>
                </tr>
              </thead>
              <tbody>
                {view.topFailingCompanies.map((c) => (
                  <tr key={c.companyId}>
                    <td className="font-heading">
                      <Link className="hover:text-primary" href={`/admin/companies/${c.companyId}`}>
                        {c.companyId}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">{c.failures}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}

function share(part: number, total: number): string {
  if (total === 0) return '—';
  return `${((part / total) * 100).toFixed(1)}% de los intentos`;
}

function Stat({
  kicker,
  value,
  note,
  tone = 'default',
}: {
  kicker: string;
  value: string;
  note: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-0.5 rounded-md bg-card px-[18px] py-4 shadow-[var(--shadow-sm)]">
      <div className="text-[10px] tracking-[0.1em] text-primary uppercase">{kicker}</div>
      <div
        className={`font-heading text-2xl ${tone === 'danger' ? 'text-[var(--color-danger)]' : ''}`}
      >
        {value}
      </div>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <code className="rounded bg-[var(--color-neutral-800)] px-1 py-0.5 font-mono text-[11px]">
      {children}
    </code>
  );
}
