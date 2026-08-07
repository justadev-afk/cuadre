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
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
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

  // The header is the shell's, which reads the session's role — so a company
  // owner working the till keeps their own left rail, a cashier keeps theirs.
  return (
    <div style={{ padding: '28px 24px', maxWidth: 560, marginInline: 'auto', width: '100%' }}>
      {active === null ? (
        <NoBankAccount />
      ) : (
        <CheckoutForm
          bankName={bankDisplayName(active.bank)}
          accountLast4={active.accountLast4}
          environment={active.environment}
        />
      )}
    </div>
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
