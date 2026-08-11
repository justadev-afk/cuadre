'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { canReach } from '../../../application/session.ts';
import { container, currentSession } from '../../_lib/current-session.ts';
import type { ChargeInput, ChargeOutcome, ReceivingAccountView } from './charge-types.ts';

export async function chargeAction(input: ChargeInput): Promise<ChargeOutcome> {
  const resolution = await currentSession();
  if (resolution.kind === 'anonymous') redirect('/login');
  if (resolution.kind === 'superseded') redirect('/session-ended');

  const { session } = resolution.active;
  // The counter is shared: a cashier works it, and so can a company owner. Both
  // reach the till, so both may charge — the guard is the same `counter` area.
  if (!canReach(session.role, 'counter') || session.companyId === null) redirect('/');

  const outcome = await container().validations.validatePayment({
    companyId: session.companyId,
    cashierId: session.userId,
    sessionId: resolution.active.sessionId,
    kind: input.kind,
    reference: input.reference,
    payerPhone: input.payerPhone,
    receivingAccount: input.receivingAccount,
    sourceBankId: input.sourceBankId,
    amountCents: input.amountCents,
    paymentDate: input.paymentDate,
    idempotencyKey: input.idempotencyKey,
    // Scoped by companyId in the use case, so an unknown id finds nothing rather
    // than reaching another merchant's connection.
    bankAccountId: input.bankAccountId,
  });

  if (!outcome.ok) return { status: 'failed', failure: outcome.error };

  const value = outcome.value;
  if (value.kind === 'confirmed') {
    const { validation } = value;
    // The rail beside the form lists this till's last charges; it has one more
    // row now, and the row is the receipt the cashier may be asked for next.
    revalidatePath('/checkout');
    return {
      status: 'confirmed',
      charge: {
        controlCode: validation.controlCode,
        kind: validation.kind,
        reference: validation.reference,
        amountCents: validation.amountCents,
        payerPhone: validation.payerPhone,
        paidAt: validation.trnAt,
        createdAt: validation.createdAt,
        isSandbox: validation.isSandbox,
        latencyMs: validation.latencyMs,
        bankAccountId: validation.bankAccountId,
      },
    };
  }

  if (value.kind === 'rejected') return { status: 'rejected', reason: value.reason };
  if (value.kind === 'already_charged') {
    return { status: 'already_charged', by: value.by, at: value.at };
  }
  return { status: 'not_found' };
}

/**
 * The accounts a connection receives transferencias in — asked the moment a
 * cashier picks a receiving bank on the Transferencia tab.
 *
 * An empty list is the honest answer "this bank cannot take transferencias
 * here", which is what the form renders: the merchant registered no account for
 * it, and a transferencia search without one finds nothing. Scoped to the
 * session's company, so a tampered connection id resolves to nothing.
 */
export async function receivingAccountsAction(
  bankAccountId: string,
): Promise<readonly ReceivingAccountView[]> {
  const resolution = await currentSession();
  if (resolution.kind === 'anonymous') redirect('/login');
  if (resolution.kind === 'superseded') redirect('/session-ended');

  const { session } = resolution.active;
  if (!canReach(session.role, 'counter') || session.companyId === null) redirect('/');

  const accounts = await container().banking.listReceivingAccounts({
    companyId: session.companyId,
    bankAccountId,
  });
  return accounts.map((account) => ({
    number: account.number,
    masked: account.masked,
    type: account.type,
    balanceCents: account.balanceCents,
  }));
}
