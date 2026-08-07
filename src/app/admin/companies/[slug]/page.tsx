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

import { BankAccountCard } from '../../../_components/bank-account-card.tsx';
import { ContentLayout } from '../../../_components/content-layout.tsx';
import { Icon } from '../../../_components/icon.tsx';
import { requireArea } from '../../../_lib/area-guard.ts';
import { container } from '../../../_lib/current-session.ts';

export default async function CompanyBanksPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireArea('admin');
  const { slug } = await params;

  const result = await container().companies.getCompany({ companyId: slug });
  if (!result.ok) notFound();
  const { company, bankAccounts } = result.value;
  const connected = bankAccounts.filter((a) => a.status !== 'removed');

  return (
    <ContentLayout
      title={company.name}
      subtitle={`${company.rif} · ${company.id}`}
      actions={
        <Link
          href="/admin/companies"
          className="btn btn-ghost"
          style={{ fontSize: 13, alignItems: 'center', gap: 6 }}
        >
          <Icon name="arrow-left" />
          Empresas
        </Link>
      }
    >
      <section className="box">
        <h6 style={{ margin: 0 }}>Bancos conectados</h6>
        {connected.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Esta empresa todavía no tiene bancos conectados.
          </p>
        ) : (
          connected.map((account) => (
            <BankAccountCard
              key={account.id}
              bank={account.bank}
              environment={account.environment}
              status={account.status}
              accountLast4={account.accountLast4}
              accountType={account.accountType}
              verifiedAt={account.verifiedAt}
            />
          ))
        )}
        <span className="text-muted" style={{ fontSize: 12 }}>
          El alta del banco la hace la empresa desde su propio panel de Bancos.
        </span>
      </section>
    </ContentLayout>
  );
}
