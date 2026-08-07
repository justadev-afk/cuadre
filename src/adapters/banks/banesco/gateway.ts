/**
 * Banesco as the port sees it: authenticate, list accounts, find one payment,
 * list a day. Composition only — every request shape, status code and unit
 * conversion belongs to the files this one calls.
 *
 * The port keeps `BankSession` opaque and deliberately carries no token, so the
 * token lives here, in a map held by the gateway the registry built **for this
 * request**. A session is therefore usable only inside the request that
 * authenticated it, which is also the only place the credentials were ever
 * unsealed.
 */
import type {
  BankAccountSummary,
  BankCredentialGroup,
  BankCredentials,
  BankEnvironment,
  BankFailure,
  BankGateway,
  BankGatewayDeps,
  BankMovement,
  BankSession,
  FindPaymentQuery,
  FoundPayment,
  ListMovementsQuery,
} from '../../../application/ports/bank-gateway.ts';
import { logger, maskReference } from '../../../shared/logger.ts';
import { err, ok, type Result } from '../../../shared/result.ts';
import { BanescoAccountsClient } from './accounts.client.ts';
import { type BanescoConfirmationCall, BanescoConfirmationClient } from './confirmation.client.ts';
import { BANESCO_ID, hasProductionEndpoints } from './endpoints.ts';
import { type BanescoDevice, serverDevice } from './envelope.ts';
import { lastFour } from './normalise.ts';
import { BanescoOauthClient } from './oauth.client.ts';

/** Below this a shared suffix is a coincidence, not the same reference. */
const MIN_MATCHABLE_DIGITS = 6;

type ActiveSession = {
  environment: BankEnvironment;
  accessToken: string;
};

export class BanescoGateway implements BankGateway {
  readonly id = BANESCO_ID;
  readonly displayName = 'Banesco';
  readonly environments: readonly BankEnvironment[] = ['production', 'sandbox'];

  /**
   * Two services, two credential pairs. Banesco issues one OAuth client for
   * confirming a transaction and a *separate* one for reading the account list,
   * and each 403s on the other's service (verified against QA). So the merchant
   * pastes the Confirmación pair — the one the counter runs on, required — and,
   * optionally, the Consulta pair that lets us list their accounts to pick the
   * receiving one. Each pair is a client id and secret; the password grant uses
   * them as their own username and password (see `oauth.client.ts`).
   */
  readonly credentialGroups: readonly BankCredentialGroup[] = [
    {
      key: 'confirmation',
      usage: 'operate',
      label: 'Confirmación de Transacciones',
      hint: 'Con estas credenciales validamos cada pago en la caja. Son obligatorias.',
      required: true,
      fields: [
        { name: 'clientId', label: 'Client ID (OAuth 2.0)', secret: false },
        { name: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
    {
      key: 'consulta',
      usage: 'discover',
      label: 'Consulta de Saldo',
      hint: 'Opcional. Si las das, listamos tus cuentas para que elijas la receptora; si no, escribes el número.',
      required: false,
      fields: [
        { name: 'clientId', label: 'Client ID (OAuth 2.0)', secret: false },
        { name: 'clientSecret', label: 'Client Secret', secret: true },
      ],
    },
  ];

  private readonly device: BanescoDevice;
  private readonly oauth: BanescoOauthClient;
  private readonly accounts: BanescoAccountsClient;
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
    this.oauth = new BanescoOauthClient(this.deps.tokens, this.deps.userAgent);
    this.accounts = new BanescoAccountsClient(this.device, this.deps.userAgent);
    this.confirmation = new BanescoConfirmationClient(this.device, this.deps.userAgent);
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

  async listAccounts(session: BankSession): Promise<Result<BankAccountSummary[], BankFailure>> {
    const resumed = this.resume(session);
    if (!resumed.ok) return resumed;

    return this.accounts.listProducts({
      environment: resumed.value.environment,
      accessToken: resumed.value.accessToken,
    });
  }

  async findPayment(
    session: BankSession,
    query: FindPaymentQuery,
  ): Promise<Result<FoundPayment | null, BankFailure>> {
    const resumed = this.resume(session);
    if (!resumed.ok) return resumed;
    const call = this.confirmationCall(resumed.value, query.sessionId);

    const exact = await this.confirmation.findByExactReference(call, query.reference);
    if (exact.kind === 'failure') return err(exact.failure);
    if (exact.kind === 'movements') {
      const match = select(exact.movements, query);
      if (match) return ok({ movement: match, strategy: 'exact_reference' });
    }

    // The bank settles a payment under its full reference some minutes after
    // it can already find it by tail and phone. Falling back automatically is
    // the difference between "todavía no aparece" and a sale.
    const tail = await this.confirmation.findByReferenceTail(call, {
      reference: query.reference,
      payerPhone: query.payerPhone,
      sourceBankId: query.sourceBankId,
      onDate: query.onDate,
    });
    if (tail.kind === 'failure') return err(tail.failure);
    if (tail.kind === 'movements') {
      const match = select(tail.movements, query);
      if (match) return ok({ movement: match, strategy: 'reference_tail_and_phone' });
    }

    // Neither route found it. That is an answer: the bank does not report
    // this payment yet.
    return ok(null);
  }

  async listMovements(
    session: BankSession,
    query: ListMovementsQuery,
  ): Promise<Result<BankMovement[], BankFailure>> {
    const resumed = this.resume(session);
    if (!resumed.ok) return resumed;

    const outcome = await this.confirmation.listByAccountRange(
      this.confirmationCall(resumed.value, session.correlationId),
      { accountId: query.accountId, from: query.from, to: query.to },
    );

    if (outcome.kind === 'failure') return err(outcome.failure);
    return ok(outcome.kind === 'movements' ? outcome.movements : []);
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

/**
 * Which of the bank's rows is the payment being validated.
 *
 * Both searches can return more than one row, and the tail search is asked
 * without an account at all — so the account is checked here, on the way out.
 * Debits are dropped: money leaving the merchant's account is never a payment
 * received, whatever its reference says.
 */
function select(movements: readonly BankMovement[], query: FindPaymentQuery): BankMovement | null {
  const wanted = lastFour(query.accountId);
  const candidates = movements.filter(
    (movement) =>
      movement.isCredit &&
      sameReference(movement.reference, query.reference) &&
      sameAccount(movement.accountMasked, wanted),
  );

  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Two credits with the same reference on one account should not exist. If the
  // bank ever reports it, the most recent is the one the customer just made —
  // and the count is logged, because it is the kind of thing that turns out to
  // matter later.
  logger.warn('banesco_ambiguous_match', {
    count: candidates.length,
    reference: maskReference(query.reference),
  });
  return candidates.reduce((latest, next) => (next.occurredAt > latest.occurredAt ? next : latest));
}

/** Equal, or one is the tail of the other — the fallback search asks by tail. */
function sameReference(candidate: string, reference: string): boolean {
  const found = candidate.replace(/\D/g, '');
  const asked = reference.replace(/\D/g, '');
  if (found === '' || asked === '') return false;
  if (found === asked) return true;

  const shorter = found.length < asked.length ? found : asked;
  if (shorter.length < MIN_MATCHABLE_DIGITS) return false;
  return found.endsWith(asked) || asked.endsWith(found);
}

/** The bank masks the account it answers with, so only the last four compare. */
function sameAccount(masked: string, wantedLastFour: string): boolean {
  const found = lastFour(masked);
  // Nothing to compare is not a mismatch: the reference and the credit
  // direction already carry the match, and refusing here would reject a real
  // payment because the bank masked one field harder than usual.
  if (found === '' || wantedLastFour === '') return true;
  return found === wantedLastFour;
}
