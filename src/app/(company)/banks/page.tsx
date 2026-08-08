/**
 * Screens 14 & 24 — the company's banks.
 *
 * A production and a sandbox account can be connected at the same time, and the
 * cards say which is which. The credential fields the "conectar" wizard draws
 * come from what the bank declares, resolved here on the server and passed down
 * — the page has no per-bank knowledge either.
 */
import { Card } from '@/components/ui/card.tsx';
import { BankAccountCard } from '../../_components/bank-account-card.tsx';
import { ContentLayout } from '../../_components/content-layout.tsx';
import { requireCompany } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { changeCredentialsAction } from './actions.ts';
import { BanksPanel } from './banks-panel.tsx';
import { ChangeCredentialsButton } from './change-credentials-button.tsx';
import { DeactivateBankButton } from './deactivate-bank-button.tsx';

export const metadata = { title: 'Bancos · Cuadre' };

export default async function BanksPage() {
  const { companyId } = await requireCompany();

  const accounts = (await container().banking.listBankAccounts({ companyId })).filter(
    (a) => a.status !== 'removed',
  );
  // Every supported bank, passed whole to the wizard's picker. One today
  // (Banesco); adding another is a registry entry, never a change here.
  const banks = container().banking.listSupportedBanks();

  return (
    <ContentLayout
      title="Bancos"
      subtitle="Cuentas donde recibes pago móvil. Una de producción y una de pruebas pueden convivir."
      actions={
        banks.length > 0 ? <BanksPanel banks={banks} hasAccount={accounts.length > 0} /> : undefined
      }
    >
      {accounts.length === 0 ? (
        <Card>
          <p className="m-0 text-[13px] text-muted-foreground">
            Todavía no tienes ningún banco conectado.
          </p>
        </Card>
      ) : (
        accounts.map((account) => {
          const info = banks.find((b) => b.id === account.bank);
          const name = info?.displayName ?? account.bank;
          return (
            <BankAccountCard
              key={account.id}
              bank={account.bank}
              environment={account.environment}
              status={account.status}
              accountLast4={account.accountLast4}
              accountType={account.accountType}
              verifiedAt={account.verifiedAt}
              action={
                <>
                  {info && (
                    <ChangeCredentialsButton
                      action={changeCredentialsAction}
                      accountId={account.id}
                      bankId={account.bank}
                      bankLabel={name}
                      environment={account.environment}
                      credentialGroups={info.credentialGroups}
                    />
                  )}
                  <DeactivateBankButton
                    accountId={account.id}
                    name={name}
                    last4={account.accountLast4}
                  />
                </>
              }
            />
          );
        })
      )}
    </ContentLayout>
  );
}
