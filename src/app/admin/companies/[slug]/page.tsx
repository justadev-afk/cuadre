/**
 * Screen 08 — one company's connected banks, from the admin side.
 *
 * The admin sees which accounts a company has linked and can start a new
 * onboarding, but the credentials themselves are never shown: an account is its
 * last four and its verification date, and nothing more ever comes back from
 * the store.
 */
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { AppNav } from '../../../_components/app-nav.tsx';
import { BankAccountCard } from '../../../_components/bank-account-card.tsx';
import { Icon } from '../../../_components/icon.tsx';
import { requireArea } from '../../../_lib/area-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import { ADMIN_LINKS } from '../../_lib/nav.ts';

export default async function CompanyBanksPage({ params }: { params: Promise<{ slug: string }> }) {
  const { session } = await requireArea('admin');
  const { slug } = await params;

  const result = await container().companies.getCompany({ companyId: slug });
  if (!result.ok) notFound();
  const { company, bankAccounts } = result.value;
  const connected = bankAccounts.filter((a) => a.status !== 'removed');

  return (
    <>
      <AppNav links={ADMIN_LINKS} current="/admin/companies" roleLabel="Admin" who={session.name} />

      <main style={{ padding: '26px 24px', maxWidth: 640, marginInline: 'auto', width: '100%' }}>
        <Link
          href="/admin/companies"
          style={{ fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          <Icon name="arrow-left" />
          Empresas
        </Link>

        <h4 style={{ margin: '12px 0 2px' }}>{company.name}</h4>
        <span className="text-muted" style={{ fontSize: 13 }}>
          {company.rif} · {company.id}
        </span>

        <h6 style={{ margin: '24px 0 10px' }}>Bancos conectados</h6>
        {connected.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13 }}>
            Esta empresa todavía no tiene bancos conectados.
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {connected.map((account) => (
              <BankAccountCard
                key={account.id}
                bank={account.bank}
                environment={account.environment}
                status={account.status}
                accountLast4={account.accountLast4}
                accountType={account.accountType}
                verifiedAt={account.verifiedAt}
              />
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 18 }}>
          <span className="text-muted" style={{ fontSize: 12 }}>
            El alta del banco la hace la empresa desde su propio panel de Bancos.
          </span>
        </div>
      </main>
    </>
  );
}
