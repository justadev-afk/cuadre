/**
 * Banesco as the port sees it: authenticate, list the merchant's accounts, and
 * find one payment — a pago móvil or a transferencia, each by its own modality.
 * Composition only — every request shape, status code and unit conversion
 * belongs to the files this one calls.
 *
 * The port keeps `BankSession` opaque and deliberately carries no token, so the
 * token lives here, in a map held by the gateway the registry built **for this
 * request**. A session is therefore usable only inside the request that
 * authenticated it, which is also the only place the credentials were ever
 * unsealed.
 */
import type {
  BankCredentialGroup,
  BankCredentials,
  BankEnvironment,
  BankFailure,
  BankGateway,
  BankGatewayDeps,
  BankMovement,
  BankPaymentKind,
  BankSession,
  FindPaymentQuery,
  FoundPayment,
} from '../../../application/ports/bank-gateway.ts';
import { sameReference } from '../../../domain/payment-match.ts';
import { AppError } from '../../../shared/errors.ts';
import { logger, maskReference } from '../../../shared/logger.ts';
import { err, ok, type Result } from '../../../shared/result.ts';
import {
  type BanescoConfirmationCall,
  BanescoConfirmationClient,
  REFERENCE_TAIL_DIGITS,
} from './confirmation.client.ts';
import { BANESCO_ID, hasProductionEndpoints } from './endpoints.ts';
import { type BanescoDevice, serverDevice } from './envelope.ts';
import { BanescoOauthClient } from './oauth.client.ts';

type ActiveSession = {
  environment: BankEnvironment;
  accessToken: string;
};

export class BanescoGateway implements BankGateway {
  readonly id = BANESCO_ID;
  readonly displayName = 'Banesco';
  readonly environments: readonly BankEnvironment[] = ['production', 'sandbox'];

  /**
   * One pair, and only one.
   *
   * Banesco publishes a second service — Consulta de Saldo, on its own client
   * under its own RIF — and it is deliberately not asked for. It answers with
   * the account numbers already masked (`0134************5306`), and
   * Confirmación de Transacciones refuses a masked `accountId` with a 400,
   * whether it is passed through as reported or stripped of its asterisks
   * (both probed against QA on 2026-08-11). It cannot produce the one thing a
   * transferencia search needs, so asking a merchant for it would be asking
   * for a credential that buys them nothing. The accounts that receive
   * transferencias are typed on the connection instead, and stay editable.
   */
  readonly credentialGroups: readonly BankCredentialGroup[] = [
    {
      key: 'confirmation',
      label: 'Confirmación de Transacciones',
      hint: 'Con estas credenciales validamos cada pago en la caja.',
      required: true,
      fields: [
        { name: 'clientId', label: 'Client ID (OAuth 2.0)', secret: false },
        { name: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
  ];

  readonly operateKey = 'confirmation';

  /**
   * What each kind of payment takes — every flag probed against QA on
   * 2026-08-11, field by field.
   *
   * A pago móvil is asked with the **last six** digits; a transferencia with the
   * **whole** reference, which is what the customer's receipt carries. Both
   * shapes answer in QA — a transferencia is found by its tail too — but the
   * full number is what a cashier is reading off the screen in front of them,
   * and asking for six of eleven digits invites transcribing the wrong six.
   *
   * `needsDate: false` on the transferencia is the one that looks like an
   * oversight and is not. See `findTransferencia`.
   */
  readonly paymentKinds: readonly BankPaymentKind[] = [
    {
      kind: 'pago_movil',
      label: 'Pago móvil',
      referenceDigits: REFERENCE_TAIL_DIGITS,
      needsPayerPhone: true,
      needsReceivingAccount: false,
      needsDate: true,
    },
    {
      kind: 'transferencia',
      label: 'Transferencia',
      referenceDigits: null,
      needsPayerPhone: false,
      needsReceivingAccount: true,
      needsDate: false,
    },
  ];

  /**
   * A Venezuelan account number is twenty digits and Banesco's own begin with
   * its Sudeban code. The merchant types them once, because the bank will not
   * tell us: Consulta de Saldo answers with them masked and the payment search
   * refuses a masked one.
   */
  readonly receivingAccountRule = {
    digits: 20,
    prefix: '0134',
    label: 'Cuentas que reciben transferencias',
    placeholder: '01340804108041005394',
  };

  private readonly device: BanescoDevice;
  private readonly oauth: BanescoOauthClient;
  private readonly confirmation: BanescoConfirmationClient;

  /**
   * The tokens this gateway opened, by correlation id. Per instance, and the
   * registry builds one instance per request: a session must not outlive the
   * request that unsealed the credentials behind it, which is exactly what a
   * map at module scope would let it do in a shared isolate.
   */
  private readonly active: Map<string, ActiveSession>;

  constructor(private readonly deps: BankGatewayDeps) {
    this.device = serverDevice(this.deps.egressIp);
    this.oauth = new BanescoOauthClient(this.deps.tokens, this.deps.userAgent, this.deps.debug);
    this.confirmation = new BanescoConfirmationClient(
      this.device,
      this.deps.userAgent,
      this.deps.debug,
    );
    this.active = new Map();
  }

  async authenticate(
    environment: BankEnvironment,
    credentials: BankCredentials,
  ): Promise<Result<BankSession, BankFailure>> {
    // Production has no published hosts yet, so `banescoEndpoints('production')`
    // throws by design. Reaching it through the OAuth client would surface that
    // throw as a 500 in the onboarding action; check first and return a clean
    // failure the wizard can show as a toast. `endpoints.ts` says as much: "check
    // first, or mean it".
    if (environment === 'production' && !hasProductionEndpoints()) {
      logger.warn('banesco_production_unconfigured', {});
      return err('unavailable');
    }

    const token = await this.oauth.getAccessToken({ environment, credentials });
    if (!token.ok) return token;

    if (environment === 'sandbox' && (await this.worksInProduction(credentials))) {
      // Production credentials filed as a sandbox would let real money move
      // through the flow we tell merchants is a test. The port has no code
      // for it; the caller turns this into `bank_environment_mismatch`.
      logger.warn('banesco_environment_mismatch', { declared: environment });
      return err('rejected_credentials');
    }

    // Not a secret and not derived from one: it exists so a support call can
    // name a conversation, and so this gateway can find its own token again.
    const correlationId = crypto.randomUUID();
    this.active.set(correlationId, { environment, accessToken: token.value });

    return ok({ bank: BANESCO_ID, environment, correlationId });
  }

  /**
   * One call, in the shape the kind declares. There is no fallback between the
   * two: each modality answers its own kind of payment and returns
   * `70001 · sin resultados` for the other, so a second attempt would only spend
   * a round trip at the counter to be told nothing.
   */
  async findPayment(
    session: BankSession,
    query: FindPaymentQuery,
  ): Promise<Result<FoundPayment | null, BankFailure>> {
    const resumed = this.resume(session);
    if (!resumed.ok) return resumed;
    const call = this.confirmationCall(resumed.value, query.sessionId);

    // The use case has already checked the claim against the kind's declaration,
    // so a missing field here is a programming error rather than a user's.
    const outcome =
      query.kind === 'transferencia'
        ? await this.confirmation.findTransferencia(call, {
            reference: query.reference,
            receivingAccount: required(query.receivingAccount, 'receivingAccount'),
            sourceBankId: query.sourceBankId,
          })
        : await this.confirmation.findPagoMovil(call, {
            reference: query.reference,
            payerPhone: required(query.payerPhone, 'payerPhone'),
            sourceBankId: query.sourceBankId,
            onDate: required(query.onDate, 'onDate'),
          });

    if (outcome.kind === 'failure') return err(outcome.failure);
    if (outcome.kind === 'movements') {
      const match = select(outcome.movements, query);
      if (match) {
        return ok({
          movement: match,
          strategy:
            query.kind === 'transferencia'
              ? 'reference_tail_and_account'
              : 'reference_tail_and_phone',
        });
      }
    }

    // The bank does not report this payment yet. That is an answer.
    return ok(null);
  }

  private resume(session: BankSession): Result<ActiveSession, BankFailure> {
    const found = this.active.get(session.correlationId);
    if (!found) {
      logger.error('banesco_session_unknown', { correlationId: session.correlationId });
      return err('unavailable');
    }
    return ok(found);
  }

  private confirmationCall(session: ActiveSession, sessionId: string): BanescoConfirmationCall {
    return {
      environment: session.environment,
      accessToken: session.accessToken,
      sessionId,
    };
  }

  /**
   * Are these sandbox credentials accepted by production? If they are, they are
   * production credentials that someone declared as a test.
   *
   * TODO(banesco-production): the bank has not published the production host, so
   * the check cannot run yet and a mis-declared production credential would pass
   * onboarding unnoticed. It degrades to a warning rather than an exception on
   * purpose — refusing every sandbox onboarding until the bank sends us a
   * hostname would be a worse failure than the one it guards against.
   */
  private async worksInProduction(credentials: BankCredentials): Promise<boolean> {
    if (!hasProductionEndpoints()) {
      logger.warn('banesco_environment_probe_skipped', { reason: 'production_endpoints_unknown' });
      return false;
    }

    // Uncached on purpose: a token minted here belongs to credentials we are
    // about to reject, and caching it would leave it behind for the next request.
    const probe = await this.oauth.requestUncachedToken({
      environment: 'production',
      credentials,
    });
    return probe.ok;
  }
}

/** A field the kind promised would be there. Absent means we built a bad query. */
function required(value: string | null, field: string): string {
  if (value === null) throw new AppError('internal', `banesco query is missing ${field}`);
  return value;
}

/**
 * Which of the bank's rows is the payment being validated.
 *
 * Matched by reference and credit direction only. The Confirmación search is
 * already scoped to the merchant by the credentials that made it, so every row
 * it returns is *this* merchant's money — which of their accounts it settled on
 * is not a reason to refuse it. A pago móvil lands on whatever account its
 * receiving phone maps to, and rejecting on that mismatch is exactly what made a
 * real payment read as "todavía no aparece". Amount and currency are the
 * domain's job in `matchPayment`. Debits are dropped: money leaving is never a
 * payment received.
 */
function select(movements: readonly BankMovement[], query: FindPaymentQuery): BankMovement | null {
  const candidates = movements.filter(
    (movement) => movement.isCredit && sameReference(movement.reference, query.reference),
  );

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // More than one credit under the same reference: take the most recent — the
  // one the customer just made — and log the count, because it should not happen
  // and is the kind of thing that turns out to matter later.
  logger.warn('banesco_ambiguous_match', {
    count: candidates.length,
    reference: maskReference(query.reference),
  });
  return candidates.reduce((latest, next) => (next.occurredAt > latest.occurredAt ? next : latest));
}
