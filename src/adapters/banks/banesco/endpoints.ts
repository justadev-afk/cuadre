/**
 * Where Banesco answers, per environment.
 *
 * QA is what the bank handed us and is written verbatim, host and path. There
 * is no production entry: the bank has not published those hosts yet, and a
 * plausible-looking guess would turn "we cannot go live yet" — something a
 * human can read on a Tuesday — into a DNS failure during someone's first real
 * sale. So the gap is a named hole that fails loudly when touched.
 */
import type { BankEnvironment } from '../../../application/ports/bank-gateway.ts';
import { AppError } from '../../../shared/errors.ts';

/** The registry key, and the value of `bank_accounts.bank`. */
export const BANESCO_ID = 'banesco';

export type BanescoEndpoints = {
  /** Keycloak. The realm is part of the path, so this is per-environment too. */
  token: string;
  /** Confirmation of Transactions — the endpoint every search mode posts to. */
  payment: string;
  /** Account Inquiry. */
  products: string;
};

const SANDBOX_HOSTS = {
  sso: 'https://sso-sso-project.apps.desplakur3.desintra.banesco.com',
  confirmation:
    'https://sid-validador-consulta-de-transacciones-api-qa-production.apps.desplakur3.desintra.banesco.com',
  accounts:
    'https://consulta-de-transacciones-y-productos-nac-api-qa-production.apps.desplakur3.desintra.banesco.com',
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
  // VERIFIED live against QA: returns DOÑA AURORA's four accounts, masked, in
  // the `httpStatus`/`dataResponse` envelope. `/me/customer/products` (below)
  // additionally demands `device.sid` and 400s without it — so this explicit
  // path, not the alias, is the one we call.
  products: '/customer/products',
} as const;

/**
 * The same service also answers on `/me/customer/products`, which resolves the
 * customer from the token instead of from the request. We call the explicit
 * path so the request says what it is asking for; this is recorded because it
 * is the first thing to try if `/customer/products` starts refusing us.
 */
export const SANDBOX_PRODUCTS_ALIAS_PATH = '/me/customer/products';

const SANDBOX_ENDPOINTS: BanescoEndpoints = {
  token: `${SANDBOX_HOSTS.sso}${SANDBOX_PATHS.token}`,
  payment: `${SANDBOX_HOSTS.confirmation}${SANDBOX_PATHS.payment}`,
  products: `${SANDBOX_HOSTS.accounts}${SANDBOX_PATHS.products}`,
};

/**
 * TODO(banesco-production): the bank has not given us the production hosts nor
 * the production realm name. Fill this in from their integration sheet — do not
 * derive it from the QA names by removing "qa", the QA hosts are cluster names
 * and the production cluster is a different one.
 */
const PRODUCTION_ENDPOINTS: BanescoEndpoints | null = null;

const PRODUCTION_MISSING =
  'banesco production endpoints are not published yet (see TODO(banesco-production) in endpoints.ts)';

/** Lets a caller degrade instead of crashing while production is still a hole. */
export function hasProductionEndpoints(): boolean {
  return PRODUCTION_ENDPOINTS !== null;
}

/** Throws for production until the hosts above exist. Check first, or mean it. */
export function banescoEndpoints(environment: BankEnvironment): BanescoEndpoints {
  if (environment === 'sandbox') return SANDBOX_ENDPOINTS;
  if (PRODUCTION_ENDPOINTS) return PRODUCTION_ENDPOINTS;
  throw new AppError('bank_unavailable', PRODUCTION_MISSING);
}
