/**
 * The till, resolved. Both `/checkout` (inside the app shell) and
 * `/checkout-express` (the cashier's sidebar-less PWA window) render this, so
 * the account resolution, the "mi turno" pane and the receipt's merchant/cashier
 * live in one place rather than two pages drifting apart.
 *
 * It resolves *which* account answers and hands the form only what it shows —
 * the bank's name, the last four, the environment, the merchant and cashier for
 * the printed receipt — never a credential.
 */
import { requireArea } from '../../_lib/area-guard.ts';
import { container } from '../../_lib/current-session.ts';
import { CheckoutForm } from './checkout-form.tsx';
import { NoBankAccount } from './no-bank-account.tsx';

export async function CheckoutContent({ express = false }: { express?: boolean } = {}) {
  const { session, needsShiftConfirmation } = await requireArea('counter');
  const companyId = session.companyId;
  // While the shift prompt blocks the till, the checkout must not also raise a
  // modal — the shift dialog is the single gate on screen. Same condition the
  // layout renders the dialog under, so the two never disagree about which one
  // shows. A company owner working the till never sees the shift prompt, so
  // their result modal is never suppressed.
  const shiftDue = needsShiftConfirmation && session.role === 'cashier';

  // A cashier always has a company; the type carries null only for a platform
  // admin, whom `requireArea('counter')` already turned away.
  const accounts = companyId ? await container().banking.listBankAccounts({ companyId }) : [];
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

  // The merchant name for the printed receipt. Absent for the (impossible here)
  // company-less session, or if the company vanished under us.
  const detail = companyId ? await container().companies.getCompany({ companyId }) : null;
  const merchantName = detail?.ok === true ? detail.value.company.name : undefined;

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
  const recent = mine.items.slice(0, 6).map((v) => ({
    controlCode: v.controlCode,
    reference: v.reference,
    amountCents: v.amountCents,
    payerPhone: v.payerPhone,
    createdAt: v.createdAt,
    isSandbox: v.isSandbox,
    latencyMs: v.latencyMs,
    sourceBankId: v.sourceBankId,
    bankAccountId: v.bankAccountId,
  }));

  if (accountViews.length === 0) return <NoBankAccount />;

  return (
    <CheckoutForm
      bankName={bankName}
      accounts={accountViews}
      environment={environment}
      recent={recent}
      turnoCount={turnoCount}
      turnoCents={turnoCents}
      merchantName={merchantName}
      cashierName={session.name}
      express={express}
      shiftDue={shiftDue}
    />
  );
}

/** The only bank today. A registry lookup would be the general form. */
function bankDisplayName(bank: string): string {
  return bank === 'banesco' ? 'Banesco' : bank;
}
