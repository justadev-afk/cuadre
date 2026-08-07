/**
 * Screens 14 & 24 — the company's banks.
 *
 * A production and a sandbox account can be connected at the same time, and the
 * cards say which is which. The credential fields the "conectar" wizard draws
 * come from what the bank declares, resolved here on the server and passed down
 * — the page has no per-bank knowledge either.
 */
import { AppNav } from '../../_components/app-nav.tsx';
import { BankAccountCard } from '../../_components/bank-account-card.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { COMPANY_LINKS } from '../_lib/nav.ts';
import { BanksPanel } from './banks-panel.tsx';

export const metadata = { title: 'Bancos · Cuadre' };

export default async function BanksPage() {
  const { resolved, companyId } = await requireCompany();

  const accounts = (await container().banking.listBankAccounts({ companyId })).filter(
    (a) => a.status !== 'removed',
  );
  // One bank today. The wizard reads its declared credential fields (Banesco: two).
  const banesco = container().banking.listSupportedBanks()[0];

  return (
    <>
      <AppNav
        links={COMPANY_LINKS}
        current="/banks"
        roleLabel="Empresa"
        who={resolved.session.name}
      />

      <main style={{ padding: '26px 24px', maxWidth: 560, marginInline: 'auto', width: '100%' }}>
        <h4 style={{ margin: '0 0 2px' }}>Bancos</h4>
        <span className="text-muted" style={{ fontSize: 13 }}>
          Cuentas donde recibes pago móvil. Una de producción y una de pruebas pueden convivir.
        </span>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, margin: '16px 0 18px' }}>
          {accounts.length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>
              Todavía no tienes ningún banco conectado.
            </p>
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
        </div>

        {banesco && (
          <BanksPanel
            displayName={banesco.displayName}
            environments={banesco.environments}
            credentialGroups={banesco.credentialGroups}
            hasAccount={accounts.length > 0}
          />
        )}
      </main>
    </>
  );
}
