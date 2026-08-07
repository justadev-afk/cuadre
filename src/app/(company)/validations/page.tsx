/**
 * Screen 09 — the company's full list of validations, every cashier's work.
 *
 * The environment filter (Todos / Producción / Sandbox) travels in the URL, so
 * the view is shareable and the page stays a Server Component. The stat band is
 * today's totals, which by construction exclude sandbox — a cash total that
 * counted test payments would be a lie the panel tells every morning.
 *
 * Everything is scoped by the session's `companyId`. There is no status column
 * because there are no unconfirmed rows: a row here is a confirmed payment.
 */

import { formatBolivares } from '../../../domain/money.ts';
import { Icon } from '../../_components/icon.tsx';
import { ValidationCards } from '../../_components/validation-list.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { queryValue, type SearchParams } from '../../_lib/inputs.ts';
import { amountDigits, formatClock } from '../../_lib/venezuela-format.ts';

export const metadata = { title: 'Validaciones · Cuadre' };

type EnvFilter = 'all' | 'production' | 'sandbox';

const ENV_TABS: readonly { value: EnvFilter; label: string; icon?: 'flask' }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'production', label: 'Producción' },
  { value: 'sandbox', label: 'Sandbox', icon: 'flask' },
];

export default async function ValidationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { companyId } = await requireCompany();
  const params = await searchParams;
  const environment = readEnv(queryValue(params, 'environment'));
  const search = queryValue(params, 'q') ?? undefined;

  const totals = await container().validations.dailyTotals({ companyId });
  const list = await container().validations.listValidations({
    companyId,
    from: totals.from,
    to: totals.to,
    environment,
    search,
  });

  // A merchant with no bank connected cannot validate anything — the counter has
  // nothing to ask. Say so here, where they land, rather than letting them find
  // out at the till with a customer waiting.
  const bankAccounts = await container().banking.listBankAccounts({ companyId });
  const hasBank = bankAccounts.some((a) => a.status !== 'removed');

  const nowSeconds = totals.to;
  const avgCents =
    totals.totalCount === 0 ? 0 : Math.round(totals.totalAmountCents / totals.totalCount);

  return (
    <main style={{ padding: '28px 24px', maxWidth: 1120, marginInline: 'auto', width: '100%' }}>
      {!hasBank && (
        <div
          className="card elev-sm"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 14,
            padding: 16,
            marginBottom: 20,
            boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 35%, transparent)',
            background: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
          }}
        >
          <span
            className="avatar"
            style={{
              width: 40,
              height: 40,
              background: 'var(--color-accent-800)',
              color: 'var(--color-accent-100)',
              fontSize: 20,
            }}
          >
            <Icon name="bank" />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--font-heading)', fontSize: 15 }}>
              Conecta un banco para empezar a validar
            </div>
            <span className="text-muted" style={{ fontSize: 12 }}>
              Sin una cuenta conectada, la caja no tiene a quién preguntarle por un pago.
            </span>
          </div>
          <a className="btn btn-primary" href="/banks" style={{ whiteSpace: 'nowrap' }}>
            <Icon name="plus" />
            Conectar banco
          </a>
        </div>
      )}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h4 style={{ margin: '0 0 2px' }}>Validaciones</h4>
          <span className="text-muted" style={{ fontSize: 13 }}>
            Hoy · {totals.totalCount} pagos validados · {formatBolivares(totals.totalAmountCents)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <div className="seg">
            {ENV_TABS.map((tab) => (
              <a
                key={tab.value}
                href={hrefFor(tab.value, search)}
                className="seg-opt"
                style={
                  tab.value === environment
                    ? {
                        color: 'var(--color-accent)',
                        boxShadow: 'inset 0 0 0 1px var(--color-accent)',
                      }
                    : undefined
                }
              >
                {tab.icon && <Icon name={tab.icon} />}
                {tab.label}
              </a>
            ))}
          </div>
          <form>
            {environment !== 'all' && (
              <input type="hidden" name="environment" value={environment} />
            )}
            <input
              className="input"
              name="q"
              defaultValue={search ?? ''}
              placeholder="Referencia o teléfono"
              style={{ width: 180 }}
            />
          </form>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
        <StatCard
          kicker="Cobrado hoy"
          value={formatBolivares(totals.totalAmountCents)}
          note={`${totals.totalCount} pagos aprobados`}
        />
        <StatCard
          kicker="Ticket promedio"
          value={formatBolivares(avgCents)}
          note="excluye sandbox"
        />
        <StatCard kicker="Pagos validados" value={String(totals.totalCount)} note="hoy" />
      </div>

      {list.items.length === 0 ? (
        <p className="text-muted" style={{ fontSize: 14, padding: '32px 0', textAlign: 'center' }}>
          No hay validaciones en este filtro.
        </p>
      ) : (
        <>
          <div style={{ overflowX: 'auto' }} className="only-desktop">
            <table className="table">
              <thead>
                <tr>
                  <th>Control</th>
                  <th>Hora</th>
                  <th>Referencia</th>
                  <th style={{ textAlign: 'right' }}>Monto (Bs)</th>
                  <th>Teléfono</th>
                  <th>Banco</th>
                </tr>
              </thead>
              <tbody>
                {list.items.map((v) => (
                  <tr key={v.id}>
                    <td
                      className="tnum"
                      style={{
                        fontFamily: 'var(--font-heading)',
                        color: 'var(--color-accent-300)',
                      }}
                    >
                      {v.controlCode}
                    </td>
                    <td className="text-muted" style={{ whiteSpace: 'nowrap' }}>
                      {formatClock(v.trnAt)}
                    </td>
                    <td className="tnum">{v.reference}</td>
                    <td
                      className="tnum"
                      style={{ textAlign: 'right', fontFamily: 'var(--font-heading)' }}
                    >
                      {amountDigits(v.amountCents)}
                    </td>
                    <td className="text-muted">{v.payerPhone}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      Banesco
                      {v.isSandbox && (
                        <span className="tag tag-outline" style={{ marginLeft: 6, fontSize: 10 }}>
                          <Icon name="flask" style={{ marginRight: 3 }} />
                          Sandbox
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="only-mobile">
            <ValidationCards items={list.items} nowSeconds={nowSeconds} />
          </div>
        </>
      )}
    </main>
  );
}

function StatCard({ kicker, value, note }: { kicker: string; value: string; note: string }) {
  return (
    <div className="card elev-sm" style={{ flex: 1, minWidth: 180, gap: 2 }}>
      <div className="card-kicker">{kicker}</div>
      <div style={{ fontFamily: 'var(--font-heading)', fontSize: 24 }}>{value}</div>
      <span className="text-muted" style={{ fontSize: 12 }}>
        {note}
      </span>
    </div>
  );
}

function hrefFor(env: EnvFilter, search: string | undefined): string {
  const parts: string[] = [];
  if (env !== 'all') parts.push(`environment=${env}`);
  if (search) parts.push(`q=${encodeURIComponent(search)}`);
  return parts.length === 0 ? '/validations' : `/validations?${parts.join('&')}`;
}

function readEnv(value: string | null): EnvFilter {
  if (value === 'production' || value === 'sandbox') return value;
  return 'all';
}
