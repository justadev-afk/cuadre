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
 * **Nothing here is cached, and that is the point.** A token used to live in KV
 * for `expires_in` minus a minute, which bought the counter one saved round trip
 * and cost it the only thing that matters: a validation that reached the bank
 * through something remembered from an earlier request. It showed on the till —
 * the first attempt took its time and every retry came back instantly, which
 * reads exactly like an answer nobody went and asked for. On the path that
 * decides whether a customer has paid, "fast because we did not ask" is the
 * wrong trade at any price, so every attempt opens its own session and every
 * answer is one the bank gave just now.
 *
 * What that costs is one extra round trip per validation, against a token
 * endpoint the bank rate-limits harder than the query one. If it ever bites, the
 * answer is fewer redundant validations, never a remembered token.
 */
import { z } from 'zod';

import type {
  BankCredentials,
  BankEnvironment,
  BankFailure,
} from '../../../application/ports/bank-gateway.ts';
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

export type BanescoTokenRequest = {
  environment: BankEnvironment;
  credentials: BankCredentials;
};

/**
 * One way in, and it always goes to the bank. There is no second, cached path —
 * there used to be, and the counter could feel it.
 */
export interface OauthClient {
  getAccessToken(request: BanescoTokenRequest): Promise<Result<string, BankFailure>>;
}

export class BanescoOauthClient implements OauthClient {
  constructor(
    private readonly userAgent: string,
    /** `BANESCO_DEBUG`. The body printed here is redacted — see below. */
    private readonly debug = false,
  ) {}

  async getAccessToken(request: BanescoTokenRequest): Promise<Result<string, BankFailure>> {
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

    // `expires_in` is read past rather than returned: nothing keeps this token
    // beyond the request that asked for it, so how long the bank would have let
    // us keep it is not a fact anybody here can use.
    return ok(parsed.data.access_token);
  }
}

/** The grant as it goes out, with everything secret replaced by `***`. */
function redactedGrant(clientId: string): string {
  return `grant_type=password&client_id=${clientId}&client_secret=***&username=${clientId}&password=***`;
}
