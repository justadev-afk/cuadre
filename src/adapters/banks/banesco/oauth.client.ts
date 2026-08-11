/**
 * OAuth 2.0 against Banesco's Keycloak realm, using the **password** grant.
 *
 * Not `client_credentials`, which is what the integration document assumed.
 * Both QA clients answer that grant with
 * `unauthorized_client: "Client not enabled to retrieve service account"` —
 * service accounts are switched off. The realm lists `password` among its
 * `grant_types_supported`, and **the client is its own resource owner**: a
 * token comes back for `username=<clientId>&password=<clientSecret>` and for
 * no other pairing. This was confirmed live against QA with both clients, and
 * a real Account Inquiry then returned DOÑA AURORA's four accounts — so there
 * is no separate API user, and the two credentials the merchant enters are all
 * the grant needs.
 *
 * A token is worth caching — the bank rate-limits the token endpoint far more
 * tightly than the query endpoints, and a checkout that mints a token first
 * spends a whole round trip before it has asked anything. It is cached in KV so
 * the isolate that serves the next sale reuses it.
 *
 * The cache key names the client by the SHA-256 of its clientId. The secret
 * never appears in a key, a log line or an error: a KV key list is readable by
 * anyone with the binding, and a hashed clientId is enough to tell two
 * merchants apart.
 */
import { z } from 'zod';

import type {
  BankCredentials,
  BankEnvironment,
  BankFailure,
} from '../../../application/ports/bank-gateway.ts';
import { sha256Hex } from '../../../shared/crypto.ts';
import { logger } from '../../../shared/logger.ts';
import { err, ok, type Result } from '../../../shared/result.ts';
import { bankFetch, parseJsonBody } from '../http.ts';
import { debugBanescoCall } from './debug.ts';
import { BANESCO_ID, banescoEndpoints } from './endpoints.ts';
import { failureForHttpStatus } from './status-codes.ts';

/** Keycloak's reply. Anything else it sends is not ours to care about. */
const TokenReply = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().int().positive(),
});

/** Keycloak's error body. `error` is a code ('invalid_client'), safe to log. */
const TokenError = z.object({ error: z.string() });

/**
 * Expire our copy a minute before the bank does. A token that dies mid-request
 * costs a retry the cashier watches; a minute of unused life costs nothing.
 */
const SAFETY_MARGIN_SECONDS = 60;

/** KV refuses a shorter TTL, so a very short-lived token is simply not cached. */
const KV_MIN_TTL_SECONDS = 60;

export type BanescoTokenRequest = {
  environment: BankEnvironment;
  credentials: BankCredentials;
};

export type BanescoToken = {
  accessToken: string;
  expiresInSeconds: number;
};

/**
 * The two ways the gateway asks for a token: the cached one every call takes,
 * and the uncached probe that must leave nothing behind.
 */
export interface OauthClient {
  getAccessToken(request: BanescoTokenRequest): Promise<Result<string, BankFailure>>;
  requestUncachedToken(request: BanescoTokenRequest): Promise<Result<BanescoToken, BankFailure>>;
}

export class BanescoOauthClient implements OauthClient {
  constructor(
    private readonly tokens: KVNamespace,
    private readonly userAgent: string,
    /** `BANESCO_DEBUG`. The body printed here is redacted — see below. */
    private readonly debug = false,
  ) {}

  /** The cached path. Everything on the checkout route uses this one. */
  async getAccessToken(request: BanescoTokenRequest): Promise<Result<string, BankFailure>> {
    const key = await tokenCacheKey(request);

    const cached = await this.tokens.get(key, 'text');
    if (cached) return ok(cached);

    const fresh = await this.requestUncachedToken(request);
    if (!fresh.ok) return fresh;

    const ttl = fresh.value.expiresInSeconds - SAFETY_MARGIN_SECONDS;
    if (ttl >= KV_MIN_TTL_SECONDS) {
      await this.tokens.put(key, fresh.value.accessToken, { expirationTtl: ttl });
    }

    return ok(fresh.value.accessToken);
  }

  /**
   * The uncached path. Used to probe an environment we are about to reject, where
   * caching the result would leave a token behind for credentials we just refused
   * to accept.
   */
  async requestUncachedToken(
    request: BanescoTokenRequest,
  ): Promise<Result<BanescoToken, BankFailure>> {
    const endpoints = banescoEndpoints(request.environment);
    const { clientId, clientSecret } = request.credentials;

    // The client is its own resource owner. The password grant's `username` and
    // `password` ARE the client id and secret — verified live against QA: a
    // token comes back for `username=<clientId>&password=<clientSecret>`, and
    // for nothing else. So there is no separate API user to collect; the two
    // fields the merchant already entered are all four the grant needs. This is
    // why `credentialFields` on the gateway is back to two entries.
    const form = new URLSearchParams({
      grant_type: 'password',
      client_id: clientId,
      client_secret: clientSecret,
      username: clientId,
      password: clientSecret,
    });

    // The debug switch prints every call we make to the bank, and this one's
    // body is four fields of credential. It is printed **redacted** rather than
    // skipped: seeing that the token call went out, and to which realm, is half
    // of debugging an auth failure — and §8 does not have a "unless a flag is
    // set" clause about secrets reaching a log.
    debugBanescoCall(this.debug, {
      method: 'POST',
      url: endpoints.token,
      body: redactedGrant(clientId),
    });

    const outcome = await bankFetch(endpoints.token, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
        'user-agent': this.userAgent,
      },
      body: form.toString(),
    });

    const where = { bank: BANESCO_ID, environment: request.environment };

    if (outcome.kind === 'timeout') {
      logger.warn('banesco_token_timeout', { ...where, timeoutMs: outcome.timeoutMs });
      return err('timeout');
    }

    if (outcome.kind === 'network') {
      logger.warn('banesco_token_unreachable', { ...where, detail: outcome.detail });
      return err('unavailable');
    }

    if (outcome.status !== 200) {
      // Only Keycloak's `error` code is logged. `error_description` can quote the
      // request back, and the request carried the client secret.
      const parsed = TokenError.safeParse(parseJsonBody(outcome.body));
      logger.warn('banesco_token_rejected', {
        ...where,
        status: outcome.status,
        reason: parsed.success ? parsed.data.error : 'unreadable',
      });
      return err(failureForHttpStatus(outcome.status));
    }

    const parsed = TokenReply.safeParse(parseJsonBody(outcome.body));
    if (!parsed.success) {
      // A 200 we cannot read is worse than a clean rejection: it means the token
      // endpoint moved or something is answering in front of it.
      logger.error('banesco_token_unreadable', where);
      return err('unavailable');
    }

    return ok({
      accessToken: parsed.data.access_token,
      expiresInSeconds: parsed.data.expires_in,
    });
  }
}

/** The grant as it goes out, with everything secret replaced by `***`. */
function redactedGrant(clientId: string): string {
  return `grant_type=password&client_id=${clientId}&client_secret=***&username=${clientId}&password=***`;
}

/**
 * Keyed by the SHA-256 of the client id: the client is its own resource owner
 * here, so the client identifies the token completely. The secret never
 * reaches a key — a KV key list is readable by anyone holding the binding.
 */
async function tokenCacheKey(request: BanescoTokenRequest): Promise<string> {
  const client = await sha256Hex(request.credentials.clientId);
  return `bank_token:${BANESCO_ID}:${request.environment}:${client}`;
}
