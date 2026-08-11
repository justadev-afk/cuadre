/**
 * The till, resolved. Both `/checkout` (inside the app shell) and
 * `/checkout-express` (the cashier's sidebar-less PWA window) render this, so
 * the bank resolution, the "mi turno" pane and the receipt's merchant/cashier
 * live in one place rather than two pages drifting apart.
 *
 * It resolves *which banks* the cashier may choose between and hands the form
 * only what it shows — each bank's name, the merchant's own label for it,
 * whether it is a sandbox, and how many digits of the reference it is asked with
 * — never a credential.
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
  // The bank's own facts, off the registry rather than off a list kept here: its
  // display name, and how many digits of the reference it wants to be asked
  // with. A second bank arrives with its own answer to both.
  const catalogue = new Map(
    container()
      .banking.listSupportedBanks()
      .map((b) => [b.id, b]),
  );
  // Production first, then sandbox — `listBankAccounts` orders by creation, so
  // the ordering the dropdown defaults to is imposed here: a shop with both
  // connected should not have a test connection preselected at a real counter.
  //
  // The receiving accounts are resolved here rather than fetched when the
  // cashier switches tabs: there are at most a handful of connections, the list
  // is cached a day, and a till that already has them renders the Transferencia
  // form without a round trip in front of a customer.
  const accountViews = await Promise.all(
    usable.map(async (a) => {
      const bank = catalogue.get(a.bank);
      const receivingAccounts = companyId
        ? await container().banking.listReceivingAccounts({ companyId, bankAccountId: a.id })
        : [];
      return {
        id: a.id,
        bankName: bank?.displayName ?? a.bank,
        label: a.label,
        isSandbox: a.environment === 'sandbox',
        paymentKinds: bank?.paymentKinds ?? [],
        receivingAccounts: receivingAccounts.map((account) => ({
          number: account.number,
          masked: account.masked,
          type: account.type,
          balanceCents: account.balanceCents,
        })),
      };
    }),
  );
  accountViews.sort((left, right) => Number(left.isSandbox) - Number(right.isSandbox));

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
    kind: v.kind,
    reference: v.reference,
    amountCents: v.amountCents,
    payerPhone: v.payerPhone,
    paidAt: v.trnAt,
    createdAt: v.createdAt,
    isSandbox: v.isSandbox,
    latencyMs: v.latencyMs,
    sourceBankId: v.sourceBankId,
    bankAccountId: v.bankAccountId,
  }));

  if (accountViews.length === 0) return <NoBankAccount />;

  return (
    <CheckoutForm
      accounts={accountViews}
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
