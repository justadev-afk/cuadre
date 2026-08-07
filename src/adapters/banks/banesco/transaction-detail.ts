/**
 * The bank's `transactionDetail` row, and its one-way trip to `BankMovement`.
 *
 * Parsed, never trusted: a reply that does not match this schema is a reply we
 * refuse, because the alternative is reading `amount` off an object that turned
 * out to be an error page. `trnType` is required for the same reason — a row
 * that will not say whether it is a credit cannot be allowed to default to one.
 */
import { z } from 'zod';

import type { BankMovement } from '../../../application/ports/bank-gateway.ts';
import { bankReply } from './envelope.ts';
import {
  decimalToCents,
  maskAccountNumber,
  padSudebanId,
  venezuelaLocalToEpochSeconds,
} from './normalise.ts';

/** The bank sends numeric fields as numbers on some services, strings on others. */
const Numeric = z.union([z.string(), z.number()]);

export const TransactionDetail = z.object({
  referenceNumber: Numeric,
  /** Decimal (19,2), e.g. '1240.00'. Never read as a float. */
  amount: Numeric,
  /** 'BS ' — with the trailing space the bank pads it to. */
  currencyCode: z.string(),
  /** Already masked by the bank: '1340************8514'. */
  accountId: z.string(),
  /** Venezuela local date and time, in two fields. */
  trnDate: z.string(),
  trnTime: z.string(),
  /** 'CR' is money in. Anything else is not a payment received. */
  trnType: z.string(),
  sourceBankId: Numeric.nullish(),
  destBankId: Numeric.nullish(),
  concept: z.string().nullish(),
  customerIdBen: z.string().nullish(),
});

export type TransactionDetail = z.infer<typeof TransactionDetail>;

/**
 * Confirmación de Transacciones V1.3 §V.b:
 *
 *   { "httpStatus": { "statusCode": "200", "statusDesc": "OK" },
 *     "dataResponse": { "transactionDetail": [ … ] } }
 *
 * and on a miss, the same shape with `"dataResponse": null` — which is why
 * `70001 · Consulta sin resultados` reaches us as a *successful* HTTP parse
 * with nothing inside, not as a broken body.
 */
export const ConfirmationReply = bankReply(
  z.object({ transactionDetail: z.array(TransactionDetail).nullish() }),
);

const CREDIT = 'CR';

/**
 * `null` when a field cannot be mapped — an amount that is not a decimal, a
 * date in a format we do not accept. The caller fails the whole reply on it.
 * Dropping the row instead would answer "no aparece" for a payment the bank
 * just told us about, and nobody would ever see why.
 */
export function toMovement(detail: TransactionDetail): BankMovement | null {
  const amountCents = decimalToCents(detail.amount);
  const occurredAt = venezuelaLocalToEpochSeconds(detail.trnDate, detail.trnTime);
  if (amountCents === null || occurredAt === null) return null;

  const reference = String(detail.referenceNumber).trim();
  if (reference === '') return null;

  return {
    reference,
    amountCents,
    currency: detail.currencyCode.trim().toUpperCase(),
    accountMasked: maskAccountNumber(detail.accountId),
    occurredAt,
    sourceBankId: padSudebanId(detail.sourceBankId),
    concept: blankToNull(detail.concept),
    beneficiaryId: blankToNull(detail.customerIdBen),
    isCredit: detail.trnType.trim().toUpperCase() === CREDIT,
  };
}

/** All of them, or none: a partially readable reply is not a readable reply. */
export function toMovements(details: readonly TransactionDetail[]): BankMovement[] | null {
  const movements: BankMovement[] = [];
  for (const detail of details) {
    const movement = toMovement(detail);
    if (!movement) return null;
    movements.push(movement);
  }
  return movements;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
