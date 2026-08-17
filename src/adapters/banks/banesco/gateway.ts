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
  isInterbankTransferencia,
  REFERENCE_TAIL_DIGITS,
} from './confirmation.client.ts';
import { BANESCO_ID, BANESCO_SUDEBAN_CODE } from './endpoints.ts';
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
   * Both kinds take a date, and for a transferencia that is a *collection*
   * rather than a promise it travels: a Banesco→Banesco transfer is found only
   * when `startDt` is absent, an interbank one only when it is present, and
   * which of the two a payment is is the payer's bank — not a question worth
   * putting to a cashier. So the till asks for the day either way and
   * `findTransferencia` decides what reaches the wire.
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
      needsDate: true,
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
    // The same four digits that decide the modality: an account at Banesco
    // begins with Banesco's Sudeban code, and it is one fact, not two.
    prefix: BANESCO_SUDEBAN_CODE,
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
   * One call, in the shape the kind — and, for a transferencia, the payer's bank
   * — calls for. There is no fallback between the modalities: each answers its
   * own kind of payment and returns `70001 · sin resultados` for the others, so
   * a second attempt would only spend a round trip at the counter to be told
   * nothing. It is also what the bank's desk complained about on 2026-08-11: a
   * first call that misses is a call whose fields they never see.
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
            onDate: required(query.onDate, 'onDate'),
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
      if (match) return ok({ movement: match, strategy: strategyFor(query) });
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
   * Live since the bank published the production realm (2026-08-17): until then
   * this degraded to a warning, because refusing every sandbox onboarding for
   * want of a hostname would have been a worse failure than the one it guards
   * against. A QA client is unknown to `realm-api-prd` and comes back 401, so
   * the honest answer now costs one token round trip at onboarding and nothing
   * at the counter.
   */
  private async worksInProduction(credentials: BankCredentials): Promise<boolean> {
    // Uncached on purpose: a token minted here belongs to credentials we are
    // about to reject, and caching it would leave it behind for the next request.
    const probe = await this.oauth.requestUncachedToken({
      environment: 'production',
      credentials,
    });
    return probe.ok;
  }
}

/**
 * Which of the three questions found it, recorded on the row.
 *
 * Three, not two, because a transferencia has two modalities and they are not
 * interchangeable: the internal one is answered by the whole reference, the
 * interbank one by its tail and the day. Flattening both into one label would
 * hide exactly the distinction the bank spent a certification round asking us
 * to make. The rule is `isInterbankTransferencia`, the same one that shaped the
 * request, so the name a row carries cannot drift from what was sent.
 */
function strategyFor(query: FindPaymentQuery): FoundPayment['strategy'] {
  if (query.kind !== 'transferencia') return 'reference_tail_and_phone';
  return isInterbankTransferencia(query.sourceBankId)
    ? 'reference_tail_and_account'
    : 'exact_reference';
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
