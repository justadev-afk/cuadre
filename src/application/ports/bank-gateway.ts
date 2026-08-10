/**
 * The port every bank speaks. One interface, one adapter per bank, chosen at
 * call time by the `bank` column of the account being read.
 *
 * Banesco is the only implementation today. It is *not* the shape of the port:
 * the port is what Cuadre needs — authenticate, list the accounts, find one
 * payment, list a day — and each adapter is responsible for getting its bank
 * to answer those four questions. Where Banesco needs a `device.ipAddress` and
 * four "search modalities", that vocabulary stays inside its adapter. A term
 * from one bank's manual appearing in this file means the port has leaked.
 *
 * Adding a bank is therefore an adapter plus a row in the registry, never a
 * change here and never a migration (`bank` is a plain TEXT column).
 */
import type { Result } from '../../shared/result.ts';

/** The registry key. Matches `bank_accounts.bank`. */
export type BankId = string;

export type BankEnvironment = 'production' | 'sandbox';

/**
 * What a company hands us at onboarding.
 *
 * `username`/`password` are optional because a bank *may* authenticate a user
 * on top of the client — but Banesco, the only bank today, does not need them:
 * its password grant uses the client id and secret as their own username and
 * password (verified against QA; see `banesco/oauth.client.ts`). They stay on
 * the type for a future bank that genuinely separates the two.
 *
 * Which fields a given bank asks for is declared by the gateway in
 * `credentialFields` — the onboarding form renders from that and knows nothing
 * about any particular bank.
 */
export type BankCredentials = {
  clientId: string;
  clientSecret: string;
  username?: string;
  password?: string;
};

/**
 * One field of a bank's onboarding form, as the bank's own adapter describes
 * it. This is what keeps the "conectar banco" screen bank-agnostic: it renders
 * whatever the selected gateway declares, in order, so a bank that needs four
 * credentials and a bank that needs two share one screen and one server action.
 */
export type BankCredentialField = {
  name: keyof BankCredentials;
  /** Spanish: a merchant reads this on the form. */
  label: string;
  /** Rendered as a password input, never echoed back, never logged. */
  secret: boolean;
  /** Spanish helper copy, shown under the field. */
  hint?: string;
};

/**
 * A bank may split its API across more than one credential pair — Banesco does:
 * one client authorises confirming a transaction, a different one authorises
 * reading the account list, and neither can call the other's service. So the
 * onboarding form asks for credentials in **groups**, one per service, and each
 * group declares what it is for.
 *
 *  - `usage: 'operate'` is the pair the counter runs on — the one that finds a
 *    payment. Exactly one group is 'operate', and it is always required.
 *  - `usage: 'discover'` is the pair that lists the merchant's accounts so they
 *    can pick which one receives payments. At most one, and optional: without
 *    it the merchant types the receiving account number by hand.
 *
 * A bank whose single credential does everything declares one 'operate' group
 * and no 'discover' group — the use case then lists accounts with the operate
 * pair. The form stays bank-agnostic: it renders whatever groups it is handed.
 */
export type BankCredentialUsage = 'operate' | 'discover';

export type BankCredentialGroup = {
  /**
   * Stable machine key for this pair — `'confirmation'`, `'consulta'`. It is
   * both the form field prefix and the key the pair is stored under inside the
   * account's credential map, so a bank can grow to N services without any code
   * outside its adapter naming one: everything downstream keys off this string.
   */
  readonly key: string;
  readonly usage: BankCredentialUsage;
  /** The service this pair belongs to, in the bank's words. Spanish. */
  readonly label: string;
  /** Spanish helper copy, shown under the group. */
  readonly hint?: string;
  /** 'operate' is always required; 'discover' is the optional one. */
  readonly required: boolean;
  readonly fields: readonly BankCredentialField[];
};

/**
 * An authenticated conversation with one bank, for one set of credentials.
 * Opaque on purpose: the token, its expiry and any per-bank session handle are
 * the adapter's business. A use case holds one and passes it back in.
 */
export type BankSession = {
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  /** Correlates our records with the bank's support desk. Never a secret. */
  readonly correlationId: string;
};

export type BankAccountSummary = {
  /**
   * The account identifier as the bank expects it back in a request — the full
   * number. It is sealed the moment it is chosen and never leaves the server
   * again.
   */
  accountId: string;
  /** Safe to render: the bank's own masking, or ours if it does not mask. */
  masked: string;
  /** Free-form per bank ('DDA', 'Corriente', 'Ahorro'). Display only. */
  type: string | null;
  balanceCents: number | null;
  /** The account holder's national id or RIF, when the bank reports it. */
  holderId: string | null;
};

/**
 * One movement, normalised. Amounts are integer cents and instants are epoch
 * seconds *here*, not at the call site: a bank returning `1240.00` as a
 * decimal string and a local date is the adapter's problem to solve, and
 * solving it twice is how a float comparison eventually approves a payment it
 * should not have.
 */
export type BankMovement = {
  reference: string;
  amountCents: number;
  /** ISO 4217-ish, already trimmed and upper-cased. 'BS' for bolívares. */
  currency: string;
  /** Masked. The full number is never echoed back out of an adapter. */
  accountMasked: string;
  occurredAt: number;
  /** Sudeban code of the paying bank, 4 digits, zero-padded. */
  sourceBankId: string | null;
  concept: string | null;
  /** The receiving party's id as the bank reports it. */
  beneficiaryId: string | null;
  /** Money in for the merchant. A debit is never a payment received. */
  isCredit: boolean;
};

/**
 * Everything that can go wrong, in Cuadre's vocabulary rather than any bank's.
 * Each adapter maps its own status codes onto these; `src/shared/errors.ts`
 * maps these onto HTTP and the Spanish copy the user reads.
 *
 * `not_found` is deliberately not an error at the counter — it is the honest
 * answer "the bank does not report this payment yet", which the UI renders as
 * *Todavía no aparece*, never as "rejected".
 */
export type BankFailure =
  | 'rejected_credentials'
  | 'no_accounts'
  | 'invalid_input'
  | 'maintenance'
  | 'unavailable'
  | 'rate_limited'
  | 'timeout';

export type FindPaymentQuery = {
  /** The receiving account, full. */
  accountId: string;
  /** The full reference the customer read off their receipt. */
  reference: string;
  /**
   * Normalised to the bank's expected form by the domain, e.g. `584143125566`
   * — or `null` when the payment has no payer phone behind it at all, which is
   * a transferencia rather than a pago móvil. Only a gateway that declares
   * `findsTransfers` is ever handed one.
   */
  payerPhone: string | null;
  /** Sudeban code of the payer's bank. */
  sourceBankId: string;
  /** `YYYY-MM-DD` in Venezuela local time. */
  onDate: string;
  /** Our cashier session id, forwarded so the bank's support can correlate. */
  sessionId: string;
};

export type ListMovementsQuery = {
  accountId: string;
  /** `YYYY-MM-DD`, inclusive. Adapters must reject a span their bank refuses. */
  from: string;
  to: string;
};

/**
 * A found payment, plus which route found it. `strategy` is recorded on the
 * validation row: when the fallback starts carrying most of the traffic, that
 * is the bank's settlement lag becoming visible, and it is worth knowing
 * before a merchant reports it.
 */
export type FoundPayment = {
  movement: BankMovement;
  strategy: 'exact_reference' | 'reference_tail_and_phone';
};

/**
 * An `interface`, not a type alias, because adapters declare `implements
 * BankGateway`: the compiler then reports a missing or drifted method against
 * the class that failed to honour the contract, instead of against whoever
 * tried to use it three files away.
 */
export interface BankGateway {
  readonly id: BankId;
  /** User-facing, Spanish where it differs. Rendered in the bank picker. */
  readonly displayName: string;
  /** Which environments this bank offers. A bank with no sandbox lists one. */
  readonly environments: readonly BankEnvironment[];
  /**
   * The credential groups this bank asks for, in the order the form should show
   * them — one group per service (see `BankCredentialGroup`). The onboarding
   * screen has no per-bank branch because of this: it renders the groups.
   */
  readonly credentialGroups: readonly BankCredentialGroup[];
  /**
   * Can this bank find a payment that carries no payer phone — a transferencia?
   *
   * A pago móvil is made *from* a phone, so a bank can search by it; a
   * transferencia has none, and the reference is the only handle there is. The
   * two are not the same question, and a bank may well answer one and not the
   * other, so the capability is declared rather than discovered: the counter
   * keeps the phone required for a bank that says `false`, and a phoneless
   * claim is never asked of one.
   */
  readonly findsTransfers: boolean;

  authenticate(
    environment: BankEnvironment,
    credentials: BankCredentials,
  ): Promise<Result<BankSession, BankFailure>>;

  listAccounts(session: BankSession): Promise<Result<BankAccountSummary[], BankFailure>>;

  /**
   * Finds the one payment matching the query, or `null` when the bank simply
   * has nothing yet. `null` is a success: it is an answer, not a fault.
   *
   * An adapter is free to try several routes internally — Banesco falls back
   * from an exact reference lookup to reference-tail plus phone — and reports
   * which one landed via `strategy`.
   */
  findPayment(
    session: BankSession,
    query: FindPaymentQuery,
  ): Promise<Result<FoundPayment | null, BankFailure>>;

  /** Reconciliation only, for the company panel. Never on the checkout path. */
  listMovements(
    session: BankSession,
    query: ListMovementsQuery,
  ): Promise<Result<BankMovement[], BankFailure>>;
}

/**
 * What every bank adapter is constructed with. It lives on the port rather
 * than in the registry so an adapter can be built directly in a test without
 * standing up the registry around it.
 */
export type BankGatewayDeps = {
  /** Where OAuth tokens are cached, keyed by bank, environment and credentials. */
  tokens: KVNamespace;
  /**
   * The egress address declared to the banks. Every bank so far validates the
   * caller by IP and wants it echoed in the request body, so it is a
   * gateway-level concern rather than a per-adapter constant.
   */
  egressIp: string;
  /** Sent as the calling application's identity. Traceable in the bank's logs. */
  userAgent: string;
};
