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
  // Production wins when a company holds both a production and a sandbox account;
  // sandbox answers a till only when it is all that is connected (the QA case).
  // Every usable account for that environment is offered — the counter asks each
  // in turn, with an optional selector to scope to one.
  const usable = accounts.filter((a) => a.status === 'active' || a.status === 'needs_reverify');
  const environment: 'production' | 'sandbox' = usable.some((a) => a.environment === 'production')
    ? 'production'
    : 'sandbox';
  const envAccounts = usable.filter((a) => a.environment === environment);
  const accountViews = envAccounts.map((a) => ({
    id: a.id,
    last4: a.accountLast4,
    bankName: bankDisplayName(a.bank),
  }));
  const bankNames = [...new Set(accountViews.map((a) => a.bankName))];
  const bankName = bankNames.length === 1 ? (bankNames[0] ?? 'el banco') : 'el banco';

  // The "mi turno" pane on the right: today's charges by whoever is signed in.
  const mine = companyId
    ? await container().validations.listMyValidations({
        companyId,
        cashierId: session.userId,
        range: 'today',
      })
    : { items: [] };
  const turnoCount = mine.items.length;
  const turnoCents = mine.items.reduce((sum, v) => sum + v.amountCents, 0);
  // The full charge per row, so tapping one in "mi turno" re-opens it read-only.
  const recent = mine.items.slice(0, 6).map((v) => ({
    controlCode: v.controlCode,
    reference: v.reference,
    amountCents: v.amountCents,
    payerPhone: v.payerPhone,
    createdAt: v.createdAt,
    isSandbox: v.isSandbox,
    latencyMs: v.latencyMs,
    sourceBankId: v.sourceBankId,
  }));

  if (accountViews.length === 0) return <NoBankAccount />;

  // Full width — the till is a two-pane layout that fills the shell's content
  // column. The header is the shell's, which reads the session's role, so a
  // company owner working the till keeps their own left rail.
  return (
    <CheckoutForm
      bankName={bankName}
      accounts={accountViews}
      environment={environment}
      recent={recent}
      turnoCount={turnoCount}
      turnoCents={turnoCents}
    />
  );
}

/** The only bank today. A registry lookup would be the general form. */
function bankDisplayName(bank: string): string {
  return bank === 'banesco' ? 'Banesco' : bank;
}
