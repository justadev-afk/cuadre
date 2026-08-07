/**
 * Screens 14 & 24 — the company's banks.
 *
 * A production and a sandbox account can be connected at the same time, and the
 * cards say which is which. The credential fields the "conectar" wizard draws
 * come from what the bank declares, resolved here on the server and passed down
 * — the page has no per-bank knowledge either.
 */
import { BankAccountCard } from '../../_components/bank-account-card.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { BanksPanel } from './banks-panel.tsx';

export const metadata = { title: 'Bancos · Cuadre' };

export default async function BanksPage() {
  const { companyId } = await requireCompany();

  const accounts = (await container().banking.listBankAccounts({ companyId })).filter(
    (a) => a.status !== 'removed',
  );
  // One bank today. The wizard reads its declared credential fields (Banesco: two).
  const banesco = container().banking.listSupportedBanks()[0];

  return (
    <ContentLayout
      title="Bancos"
      subtitle="Cuentas donde recibes pago móvil. Una de producción y una de pruebas pueden convivir."
      actions={
        banesco ? (
          <BanksPanel
            displayName={banesco.displayName}
            environments={banesco.environments}
            credentialGroups={banesco.credentialGroups}
            hasAccount={accounts.length > 0}
          />
        ) : undefined
      }
    >
      {accounts.length === 0 ? (
        <section className="box">
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Todavía no tienes ningún banco conectado.
          </p>
        </section>
      ) : (
        accounts.map((account) => (
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
    </ContentLayout>
  );
}
