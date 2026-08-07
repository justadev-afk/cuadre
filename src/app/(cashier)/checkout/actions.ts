'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { canReach } from '../../../application/session.ts';
import { container, currentSession } from '../../_lib/current-session.ts';
import type { ChargeInput, ChargeOutcome } from './charge-types.ts';

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
    reference: input.reference,
    payerPhone: input.payerPhone,
    sourceBankId: input.sourceBankId,
    amountCents: input.amountCents,
    idempotencyKey: input.idempotencyKey,
    // Narrowed rather than trusted: the field is typed, and a typed field is
    // still whatever arrived over the wire.
    environment: input.environment === 'sandbox' ? 'sandbox' : 'production',
    // Absent → validate against every connected account for the environment.
    // Scoped by companyId in the use case, so an unknown id just finds nothing.
    accountId: input.accountId,
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
        reference: validation.reference,
        amountCents: validation.amountCents,
        payerPhone: validation.payerPhone,
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
