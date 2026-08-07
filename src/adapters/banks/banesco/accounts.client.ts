/**
 * Account Inquiry: which accounts these credentials can see.
 *
 * Asked once, at onboarding, so the merchant can pick the account their pagos
 * móviles land in. Never on the checkout path.
 *
 * The request carries no filter of any kind — the token already says whose
 * accounts these are, and sending an account number to ask which account
 * numbers exist is how an integration ends up trusting a value it typed itself.
 */
import { z } from 'zod';

import type {
  BankAccountSummary,
  BankEnvironment,
  BankFailure,
} from '../../../application/ports/bank-gateway.ts';
import { logger } from '../../../shared/logger.ts';
import { err, ok, type Result } from '../../../shared/result.ts';
import { bankFetch, parseJsonBody } from '../http.ts';
import { BANESCO_ID, banescoEndpoints } from './endpoints.ts';
import { type BanescoDevice, bankReply, dataRequest } from './envelope.ts';
import { decimalToCents, maskAccountNumber } from './normalise.ts';
import { classifyStatus, failureForHttpStatus } from './status-codes.ts';

/**
 * One row of `dataResponse`, exactly as Consulta de Cuentas V2.0 §V.b defines
 * it. Three fields, and no more: there is no `productType`, no `currencyCode`
 * and no `customerId` in this service.
 *
 * **`accountId` arrives MASKED** — the manual's own example is
 * `0134************1234`. That is a problem for onboarding, not a detail:
 * Confirmación de Transacciones wants `accountId` as a full String(20), and
 * this service cannot supply one. The merchant has to complete the number and
 * we verify it against this mask. See `accountIdIsUsable` on the gateway.
 */
const Account = z.object({
  accountId: z.string().min(4),
  accountType: z.string().nullish(),
  balance: z.union([z.string(), z.number()]).nullish(),
});

const AccountsReply = bankReply(z.array(Account));

/**
 * The half of a call that only exists once a session is open: which environment
 * authenticated, and the token it answered with. The device envelope and the
 * user agent are the same for every call and belong to the client itself.
 */
export type BanescoAccountsCall = {
  environment: BankEnvironment;
  accessToken: string;
};

/** Asking the bank which accounts a set of credentials can see. */
export interface AccountsClient {
  listProducts(call: BanescoAccountsCall): Promise<Result<BankAccountSummary[], BankFailure>>;
}

export class BanescoAccountsClient implements AccountsClient {
  constructor(
    private readonly device: BanescoDevice,
    private readonly userAgent: string,
  ) {}

  async listProducts(
    call: BanescoAccountsCall,
  ): Promise<Result<BankAccountSummary[], BankFailure>> {
    const endpoints = banescoEndpoints(call.environment);
    const where = { bank: BANESCO_ID, environment: call.environment };

    const outcome = await bankFetch(endpoints.products, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${call.accessToken}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': this.userAgent,
      },
      body: JSON.stringify(dataRequest({ device: this.device })),
    });

    if (outcome.kind === 'timeout') {
      logger.warn('banesco_products_timeout', { ...where, timeoutMs: outcome.timeoutMs });
      return err('timeout');
    }

    if (outcome.kind === 'network') {
      logger.warn('banesco_products_unreachable', { ...where, detail: outcome.detail });
      return err('unavailable');
    }

    const parsed = AccountsReply.safeParse(parseJsonBody(outcome.body));
    if (!parsed.success) {
      logger.error('banesco_products_unreadable', { ...where, status: outcome.status });
      return err(failureForHttpStatus(outcome.status));
    }

    const { statusCode } = parsed.data.httpStatus;
    const status = classifyStatus(statusCode);
    if (status.kind === 'failure') {
      logger.warn('banesco_products_failed', {
        ...where,
        statusCode: String(statusCode),
        failure: status.failure,
      });
      return err(status.failure);
    }

    const products = parsed.data.dataResponse ?? [];

    // 'no results' from an account inquiry is not the friendly "not yet" that it
    // is on a payment lookup: these credentials genuinely see no account, and the
    // merchant cannot finish onboarding until the bank affiliates one.
    if (status.kind !== 'ok' || products.length === 0) return err('no_accounts');

    return ok(products.map(toSummary));
  }
}

function toSummary(account: z.infer<typeof Account>): BankAccountSummary {
  const { balance } = account;
  const reported = account.accountId.trim();

  return {
    // Masked at the source. Kept verbatim so the onboarding step can check the
    // number the merchant completes against the very characters the bank sent,
    // rather than against a re-masked copy of them.
    accountId: reported,
    masked: maskAccountNumber(reported),
    type: blankToNull(account.accountType),
    // A balance we cannot parse is shown as unknown, never as zero: "0,00 Bs"
    // beside an account is a statement, and it would be one we did not verify.
    balanceCents: balance === null || balance === undefined ? null : decimalToCents(balance),
    // Consulta de Cuentas V2.0 has no holder field. The RIF arrives on the
    // confirmation reply instead, as `customerIdBen`.
    holderId: null,
  };
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
