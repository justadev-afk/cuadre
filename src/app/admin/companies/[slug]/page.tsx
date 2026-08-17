/**
 * Screen 08 — one company, in full, from the admin side: who it is, how much it
 * is used, its people, its banks, and its most recent validations.
 *
 * Every figure is real and scoped to this one company. The usage numbers come
 * from the same use cases the merchant's own panel uses (`dailyTotals`,
 * `listValidations`), so the admin sees exactly what the shop sees, never a
 * second, drifting definition of "cobrado hoy". Credentials are never shown: an
 * account is its last four and its verification date, and nothing more.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Badge } from '@/components/ui/badge.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Card } from '@/components/ui/card.tsx';
import { formatBolivares } from '../../../../domain/money.ts';
import { AttemptInsightsPanel } from '../../../_components/attempt-insights-panel.tsx';
import { BankAccountCard } from '../../../_components/bank-account-card.tsx';
import { ContentLayout } from '../../../_components/content-layout.tsx';
import { Icon } from '../../../_components/icon.tsx';
import { ValidationList } from '../../../_components/validation-list.tsx';
import { requireArea } from '../../../_lib/area-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { formatDate, formatDayClock, initialsOf } from '../../../_lib/venezuela-format.ts';
import { BanksPanel } from '../../../(company)/banks/banks-panel.tsx';
import { ChangeCredentialsButton } from '../../../(company)/banks/change-credentials-button.tsx';

export default async function CompanyDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireArea('admin');
  const { slug } = await params;

  const result = await container().companies.getCompany({ companyId: slug });
  if (!result.ok) notFound();
  const { company, bankAccounts } = result.value;
  const banks = container().banking.listSupportedBanks();

  const now = Math.floor(Date.now() / 1000);
  const [employees, today, month, recent, insights] = await Promise.all([
    container().employees.listEmployees({ companyId: slug }),
    container().validations.dailyTotals({ companyId: slug, days: 1 }),
    container().validations.dailyTotals({ companyId: slug, days: 30 }),
    container().validations.listValidations({ companyId: slug, from: 0, to: now }),
    container().observability.attemptInsights({ days: 30, companyId: slug }),
  ]);

  const cashiers = employees.filter((e) => e.role === 'cashier');
  const connected = bankAccounts.filter((a) => a.status !== 'removed');
  const lastValidation = recent.items[0] ?? null;

  return (
    <ContentLayout
      title={company.name}
      subtitle={`${company.rif} · ${company.id}${company.industry ? ` · ${company.industry}` : ''}`}
      actions={
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/companies">
            <Icon name="arrow-left" />
            Empresas
          </Link>
        </Button>
      }
    >
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--color-accent-800)] font-heading text-sm text-[var(--color-accent-100)]">
              {initialsOf(company.name)}
            </span>
            <div>
              <div className="font-heading text-[17px]">{company.name}</div>
              <span className="text-xs text-muted-foreground">
                Creada {formatDate(company.createdAt)}
              </span>
            </div>
          </div>
          <Badge variant={company.status === 'active' ? 'accent' : 'neutral'}>
            {company.status === 'active' ? 'Activa' : 'Suspendida'}
          </Badge>
        </div>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Stat
          kicker="Usuarios"
          value={String(employees.length)}
          note={`${cashiers.length} ${cashiers.length === 1 ? 'cajero' : 'cajeros'}`}
        />
        <Stat
          kicker="Validaciones hoy"
          value={String(today.totalCount)}
          note={formatBolivares(today.totalAmountCents)}
        />
        <Stat
          kicker="Validaciones 30 días"
          value={String(month.totalCount)}
          note={formatBolivares(month.totalAmountCents)}
        />
        <Stat kicker="Bancos" value={String(connected.length)} note="conectados" />
        <Stat
          kicker="Última validación"
          value={lastValidation === null ? '—' : formatDayClock(lastValidation.createdAt, now)}
          note={lastValidation === null ? 'sin actividad' : `ref ${lastValidation.reference}`}
        />
      </div>

      <div>
        <h6 className="mb-2 text-primary">Usuarios</h6>
        {employees.length === 0 ? (
          <Card>
            <p className="m-0 py-3 text-center text-sm text-muted-foreground">
              Esta empresa no tiene usuarios.
            </p>
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Rol</th>
                  <th>Usuario / correo</th>
                  <th>Estado</th>
                  <th>Último acceso</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => (
                  <tr key={e.id}>
                    <td className="font-heading">{e.name}</td>
                    <td>
                      <Badge variant={e.role === 'cashier' ? 'accent' : 'neutral'}>
                        {e.role === 'cashier' ? 'Cajero' : 'Empresa'}
                      </Badge>
                    </td>
                    <td className="text-muted-foreground">{e.username ?? e.email ?? '—'}</td>
                    <td>
                      {e.status === 'active' ? (
                        <span className="text-xs text-muted-foreground">Activo</span>
                      ) : (
                        <Badge variant="neutral">Inhabilitado</Badge>
                      )}
                    </td>
                    <td className="text-muted-foreground">
                      {e.lastLoginAt === null ? 'Nunca' : formatDayClock(e.lastLoginAt, now)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
          <h6 className="m-0 text-primary">Bancos conectados</h6>
          {banks.length > 0 && (
            <BanksPanel banks={banks} hasAccount={connected.length > 0} companyId={slug} />
          )}
        </div>
        {connected.length === 0 ? (
          <Card>
            <p className="m-0 py-3 text-center text-sm text-muted-foreground">
              Esta empresa todavía no tiene bancos conectados. Conéctale uno para el alta inicial.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-2">
            {connected.map((account) => {
              const info = banks.find((b) => b.id === account.bank);
              return (
                <BankAccountCard
                  key={account.id}
                  bank={account.bank}
                  environment={account.environment}
                  status={account.status}
                  label={account.label}
                  clientIdLast6={account.clientIdLast6}
                  verifiedAt={account.verifiedAt}
                  action={
                    info && (
                      <ChangeCredentialsButton
                        accountId={account.id}
                        companyId={slug}
                        bankId={account.bank}
                        bankLabel={info.displayName}
                        environment={account.environment}
                        credentialGroups={info.credentialGroups}
                        receivingAccountRule={info.receivingAccountRule}
                        receivingAccounts={account.receivingAccounts}
                      />
                    )
                  }
                />
              );
            })}
          </div>
        )}
        <span className="mt-1 block text-xs text-muted-foreground">
          El alta del banco la hace la empresa desde su propio panel de Bancos.
        </span>
      </div>

      <div>
        <h6 className="mb-2 text-primary">Observabilidad</h6>
        <AttemptInsightsPanel view={insights} scope="company" />
      </div>

      <div>
        <h6 className="mb-2 text-primary">Validaciones recientes</h6>
        {recent.items.length === 0 ? (
          <Card>
            <p className="m-0 py-3 text-center text-sm text-muted-foreground">
              Todavía no hay validaciones.
            </p>
          </Card>
        ) : (
          <ValidationList
            items={recent.items}
            nowSeconds={now}
            showCashier
            merchantName={company.name}
            merchantRif={company.rif}
          />
        )}
      </div>
    </ContentLayout>
  );
}

function Stat({ kicker, value, note }: { kicker: string; value: string; note: string }) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-0.5 rounded-md bg-card px-[18px] py-4 shadow-[var(--shadow-sm)]">
      <div className="text-[10px] tracking-[0.1em] text-primary uppercase">{kicker}</div>
      <div className="font-heading text-2xl">{value}</div>
      <span className="text-xs text-muted-foreground">{note}</span>
    </div>
  );
}
