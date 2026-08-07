/**
 * Screen 15 — the till. Four fields and the bank's answer.
 *
 * The page resolves *which* account answers and hands the form the three things
 * it shows — the bank's name, the last four, the environment — and nothing
 * else: the credentials never leave the server, and the form calls a Server
 * Action for the bank round trip so the reference and the amount are checked
 * where they cannot be edited.
 *
 * Production wins when a company holds both a production and a sandbox account;
 * the sandbox one only answers a till when it is the only one connected, which
 * is the acceptance-testing case.
 */
import { AppNav } from '../../_components/app-nav.tsx';
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { COMPANY_LINKS } from '../../(company)/_lib/nav.ts';
import { CASHIER_LINKS, cashierWho } from '../_lib/nav.ts';
import { CheckoutForm } from './checkout-form.tsx';
import { NoBankAccount } from './no-bank-account.tsx';

export const metadata = { title: 'Cobrar · Cuadre' };

export default async function CheckoutPage() {
  const { session } = await requireArea('counter');
  const companyId = session.companyId;

  // A cashier always has a company; the type carries null only for a platform
  // admin, whom `requireArea('counter')` already turned away.
  const accounts = companyId ? await container().banking.listBankAccounts({ companyId }) : [];

  const active = pickActiveAccount(accounts);

  // The counter is shared: a cashier reaches it, and so does a company owner
  // working the till. Each keeps their own header rather than being handed the
  // other role's — a company owner here still sees Validaciones, Empleados,
  // Bancos and Cobrar, with "Cobrar" marked.
  const isCompany = session.role === 'company';

  return (
    <>
      <AppNav
        links={isCompany ? COMPANY_LINKS : CASHIER_LINKS}
        current="/checkout"
        roleLabel={isCompany ? 'Empresa' : 'Cajero'}
        who={isCompany ? session.name : cashierWho(session.name, session.username)}
      />
      {active === null ? (
        <NoBankAccount />
      ) : (
        <CheckoutForm
          bankName={bankDisplayName(active.bank)}
          accountLast4={active.accountLast4}
          environment={active.environment}
        />
      )}
    </>
  );
}

type ActiveAccount = { bank: string; accountLast4: string; environment: 'production' | 'sandbox' };

/**
 * Which connected account a charge goes to. An active production account is
 * preferred over a sandbox one; a sandbox account answers only when it is the
 * only thing connected. A `needs_reverify` account still answers — closing a
 * till a week before anything is actually wrong is the worse failure.
 */
function pickActiveAccount(
  accounts: readonly {
    bank: string;
    environment: 'production' | 'sandbox';
    accountLast4: string;
    status: string;
  }[],
): ActiveAccount | null {
  const usable = accounts.filter((a) => a.status === 'active' || a.status === 'needs_reverify');
  const production = usable.find((a) => a.environment === 'production');
  const chosen = production ?? usable.find((a) => a.environment === 'sandbox') ?? null;
  return chosen === null
    ? null
    : { bank: chosen.bank, accountLast4: chosen.accountLast4, environment: chosen.environment };
}

/** The only bank today. A registry lookup would be the general form. */
function bankDisplayName(bank: string): string {
  return bank === 'banesco' ? 'Banesco' : bank;
}
