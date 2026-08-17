/**
 * `POST /api/checkout/charge` — the counter asking the bank whether a payment
 * landed, and recording it when it did.
 *
 * The money path, so two things are stated rather than assumed.
 *
 * **The claim is untrusted and is parsed as such.** A Server Action received a
 * typed object; a route handler receives whatever was posted, so the body goes
 * through zod and a malformed one is refused before the bank is asked. Nothing
 * about that changes the rule that matters (§5): what the cashier typed is
 * compared against the movement the bank returned, and approval is born from the
 * movement.
 *
 * **Who is charging comes from the cookie, never from the body.** `companyId`,
 * `cashierId` and `sessionId` are read off the session here — a body carrying a
 * company id is a body somebody can retype.
 */
import { z } from 'zod';

import { jsonResponse, requireApi, unauthorised } from '../../../_lib/api-guard.ts';
import { container } from '../../../_lib/current-session.ts';
import type { ChargeOutcome } from '../../../(cashier)/checkout/charge-types.ts';

/**
 * The claim, exactly as `ChargeInput` declares it. Lengths are generous on
 * purpose: this is a shape check, not a second copy of the counter's rules —
 * what a kind may carry is the gateway's `paymentKinds`, checked by the use
 * case, and restating it here would be the §4 leak in a new place.
 */
const Claim = z.object({
  kind: z.enum(['pago_movil', 'transferencia']),
  reference: z.string().min(1).max(40),
  payerPhone: z.string().max(20).nullable(),
  receivingAccount: z.string().max(34).nullable(),
  sourceBankId: z.string().min(1).max(8),
  amountCents: z.number().int().positive(),
  paymentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  idempotencyKey: z.string().min(1).max(100),
  bankAccountId: z.string().min(1).max(60),
});

export async function POST(request: Request): Promise<Response> {
  // The counter is shared: a cashier works it, and so can a company owner.
  const guard = await requireApi('counter');
  if (!guard.ok) return guard.response;

  const { session, sessionId } = guard.resolved;
  if (session.companyId === null) return unauthorised();

  const claim = Claim.safeParse(await request.json().catch(() => null));
  if (!claim.success) {
    // Not `rejected`: nothing was compared against a bank. It is a request the
    // counter could not have produced, and the screen shows it as a fault.
    const outcome: ChargeOutcome = { status: 'failed', failure: 'invalid_input' };
    return jsonResponse(outcome);
  }

  const input = claim.data;
  const result = await container().validations.validatePayment({
    companyId: session.companyId,
    cashierId: session.userId,
    sessionId,
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

  return jsonResponse(outcomeOf(result));
}

/** The use case's answer in the vocabulary the counter's modal renders. */
function outcomeOf(
  result: Awaited<ReturnType<ReturnType<typeof container>['validations']['validatePayment']>>,
): ChargeOutcome {
  if (!result.ok) return { status: 'failed', failure: result.error };

  const value = result.value;
  if (value.kind === 'confirmed') {
    const { validation } = value;
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
