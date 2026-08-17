/**
 * Where Banesco answers, per environment.
 *
 * Both are what the bank handed us, written verbatim, host and path. Neither is
 * derived from the other: the production cluster is `proplakur`, the QA one
 * `desplakur3`, and production sits behind a 3scale gateway that publishes the
 * resource at a **different path** — `/financial-account/transactions`, without
 * QA's `/transactions` prefix. Asking production the QA path answers
 * `404 · No Mapping Rule matched` (probed 2026-08-17), which is exactly the
 * failure a plausible-looking guess would have produced during a real sale.
 */
import type { BankEnvironment } from '../../../application/ports/bank-gateway.ts';

/** The registry key, and the value of `bank_accounts.bank`. */
export const BANESCO_ID = 'banesco';

/**
 * Banesco's own Sudeban code — the four digits that say a payer banks *here*.
 *
 * Not decoration: it is what tells the two transferencia modalities apart. A
 * transfer from another entity is *interbancaria* and is asked for one way; one
 * from Banesco to Banesco is internal and is asked for another (see
 * `confirmation.client.ts`). It sits beside `BANESCO_ID` because both are the
 * bank's identity, in the two vocabularies that name it: ours and Sudeban's.
 */
export const BANESCO_SUDEBAN_CODE = '0134';

export type BanescoEndpoints = {
  /** Keycloak. The realm is part of the path, so this is per-environment too. */
  token: string;
  /** Confirmation of Transactions — the endpoint both search modalities post to. */
  payment: string;
};

const SANDBOX_HOSTS = {
  sso: 'https://sso-sso-project.apps.desplakur3.desintra.banesco.com',
  confirmation:
    'https://sid-validador-consulta-de-transacciones-api-qa-production.apps.desplakur3.desintra.banesco.com',
} as const;

const SANDBOX_PATHS = {
  // VERIFIED live against QA: a token comes back for the password grant with
  // username=<clientId>, password=<clientSecret>.
  token: '/auth/realms/realm-api-qa/protocol/openid-connect/token',
  // VERIFIED live against QA: returns the test pago móvil (ref 12346090431,
  // Bs 630, trnType CR) for both search modes. The credentials email pasted
  // this path with a long tail of copy-paste debris from its table cell
  // (`.../transactions/financial-account/payment/transaction` appended twice) —
  // the real endpoint is just the resource, `/transactions/financial-account/
  // transactions`. The debris was what produced the OpenShift router's
  // "Resource not found"; this path answers 200.
  payment: '/transactions/financial-account/transactions',
} as const;

const SANDBOX_ENDPOINTS: BanescoEndpoints = {
  token: `${SANDBOX_HOSTS.sso}${SANDBOX_PATHS.token}`,
  payment: `${SANDBOX_HOSTS.confirmation}${SANDBOX_PATHS.payment}`,
};

const PRODUCTION_HOSTS = {
  sso: 'https://sso-sso-project.apps.proplakur.banesco.com',
  confirmation:
    'https://sid-validador-consulta-de-transacciones-3scale-apicast-61e25ec.apps.proplakur.banesco.com',
} as const;

const PRODUCTION_PATHS = {
  // VERIFIED live against production (2026-08-17): the same password grant with
  // username=<clientId>, password=<clientSecret> returns a 300-second token.
  // The realm is `realm-api-prd`, not QA's `realm-api-qa`.
  token: '/auth/realms/realm-api-prd/protocol/openid-connect/token',
  // VERIFIED live against production (2026-08-17): a pago móvil search for a
  // reference that does not exist answers the bank's own envelope,
  // `70001 · Consulta sin resultados`. Note there is **no `/transactions`
  // prefix** here — that is QA's shape and the production gateway answers it
  // with `404 · No Mapping Rule matched`.
  payment: '/financial-account/transactions',
} as const;

const PRODUCTION_ENDPOINTS: BanescoEndpoints = {
  token: `${PRODUCTION_HOSTS.sso}${PRODUCTION_PATHS.token}`,
  payment: `${PRODUCTION_HOSTS.confirmation}${PRODUCTION_PATHS.payment}`,
};

export function banescoEndpoints(environment: BankEnvironment): BanescoEndpoints {
  return environment === 'sandbox' ? SANDBOX_ENDPOINTS : PRODUCTION_ENDPOINTS;
}
