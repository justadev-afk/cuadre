/**
 * The port every bank speaks. One interface, one adapter per bank, chosen at
 * call time by the `bank` column of the account being read.
 *
 * Banesco is the only implementation today. It is *not* the shape of the port:
 * the port is what Cuadre needs — authenticate, list the merchant's accounts,
 * and find one payment — and each adapter is responsible for getting its bank
 * to answer those three questions. Where Banesco needs a `device.ipAddress` and
 * a "search modality", that vocabulary stays inside its adapter. A term from one
 * bank's manual appearing in this file means the port has leaked.
 *
 * Adding a bank is therefore an adapter plus a row in the registry, never a
 * change here and never a migration (`bank` is a plain TEXT column).
 *
 * **Two kinds of payment, and a bank decides what each one takes.** A pago móvil
 * is found by the payer's phone, their bank's code and the date; a transferencia
 * by the merchant's own receiving account — and, verified against Banesco QA on
 * 2026-08-11, *without* a date, which makes the same search return
 * `70001 · sin resultados`. Neither shape is hard-coded here: a gateway declares
 * its `paymentKinds` and the counter renders one form per kind from that.
 */
import type { Result } from '../../shared/result.ts';

/** The registry key. Matches `bank_accounts.bank`. */
export type BankId = string;

export type BankEnvironment = 'production' | 'sandbox';

/**
 * What the customer did. Stored on every validation (`validations.kind`), shown
 * in the listings and printed on the receipt, because "Bs 630 de la referencia
 * 090431" reads differently depending on which it was.
 */
export type PaymentKind = 'pago_movil' | 'transferencia';

/**
 * What one kind of payment takes, at one bank. The counter builds its form from
 * this and the use case refuses a claim that does not fit it, so neither has a
 * per-bank branch and neither says "six digits" or "needs a phone" itself.
 *
 * Every flag is a fact verified against the bank, not read off its manual. The
 * manual, for instance, lists `startDt` among the required fields of the
 * transferencia modality; sending it makes the search fail.
 */
export type BankPaymentKind = {
  readonly kind: PaymentKind;
  /** Spanish, for the selector beside "Validar pago". */
  readonly label: string;
  /**
   * How many digits of the reference this search is asked with, or `null` when
   * it wants the **whole** reference.
   *
   * The two are different questions and not a length setting: a tail is a fixed
   * count the counter must collect exactly, while a full reference is whatever
   * the customer's receipt says — which for Banesco runs 11 or 12 digits and is
   * not worth refusing over one. The screen labels the field from this and the
   * use case validates from it, so neither has to know which bank it is.
   */
  readonly referenceDigits: number | null;
  /** The payer's mobile. A pago móvil is made from one; a transferencia is not. */
  readonly needsPayerPhone: boolean;
  /** The merchant's own receiving account, full — the transferencia's handle. */
  readonly needsReceivingAccount: boolean;
  /** The day of the operation. False where sending it breaks the search. */
  readonly needsDate: boolean;
};

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
 * `credentialGroups` — the onboarding form renders from that and knows nothing
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
 * A bank may split its API across more than one credential pair, so the
 * onboarding form asks for credentials in **groups**, one per service, and the
 * gateway names the one the counter validates with (`operateKey`).
 *
 * Banesco needs exactly one. It offers a second service, Consulta de Saldo, on
 * a separate client — and that service answers with the account numbers already
 * masked (`0134************5394`), which the payment search then refuses with a
 * 400 (probed against QA, 2026-08-11, as reported and with the asterisks
 * stripped). A credential that cannot produce a usable answer is a credential
 * not worth asking a merchant for, so it is not in the form.
 */
export type BankCredentialGroup = {
  /**
   * Stable machine key for this pair — `'confirmation'`. It is both the form
   * field prefix and the key the pair is stored under in
   * `bank_account_credentials.cred_key`, so a bank can grow to N services
   * without any code outside its adapter naming one.
   */
  readonly key: string;
  /** The service this pair belongs to, in the bank's words. Spanish. */
  readonly label: string;
  /** Spanish helper copy, shown under the group. */
  readonly hint?: string;
  /** A group left blank is a refusal when this is true, and skipped when not. */
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

/**
 * How a bank spells the accounts that receive a transferencia — the shape the
 * merchant's own numbers have to match.
 *
 * It is on the port for the same reason `referenceDigits` is: the screen that
 * collects them must not know that a Venezuelan account is twenty digits
 * beginning with the bank's own four. A second bank arrives with its own
 * numbers, its own length and its own prefix, and the field, its placeholder,
 * its helper line and the refusal that guards it all move with it. `null` is a
 * bank that has no such concept, and its transferencia form asks for nothing.
 */
export type BankReceivingAccountRule = {
  /** Exact number of digits. Venezuelan accounts: 20. */
  readonly digits: number;
  /** The digits every one of this bank's accounts starts with ('0134'), if any. */
  readonly prefix: string | null;
  /** Spanish, on the field. */
  readonly label: string;
  /** A real one of this bank's numbers, so the shape is obvious. */
  readonly placeholder: string;
};

/**
 * One movement, normalised. Amounts are integer cents and instants are epoch
 * seconds *here*, not at the call site: a bank returning `1240.00` as a
 * decimal string and a local date is the adapter's problem to solve, and
 * solving it twice is how a float comparison eventually approves a payment it
 * should not have.
 */
export type BankMovement = {
  /**
   * As the bank spells it. The counter only ever types the last few digits
   * (see `referenceDigits`), so this is normally the *fuller* of the two and it
   * is what gets recorded — the customer's receipt carries this number.
   */
  reference: string;
  amountCents: number;
  /** ISO 4217-ish, already trimmed and upper-cased. 'BS' for bolívares. */
  currency: string;
  /**
   * The origin the bank reports, masked — the full value is never echoed back
   * out of an adapter.
   *
   * Nothing stores it, on purpose. For a pago móvil it *is* the payer's phone
   * (Banesco returns `5841************5031` for `584143775031`), which the
   * validation already keeps in full and unmasked, so a column for it would be
   * the same fact twice and the worse copy of the two. It stays on the movement
   * because it is part of reading the bank's row honestly, and because a future
   * search that is not a pago móvil would put something else here.
   */
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
  | 'invalid_input'
  | 'maintenance'
  | 'unavailable'
  | 'rate_limited'
  | 'timeout';

/**
 * The one question the counter asks, in the shape the chosen `kind` declared.
 *
 * The optional fields are optional *per kind*, never per whim: a pago móvil
 * carries a phone and a date and no account, a transferencia the reverse. What
 * a kind declares it needs is present; what it declares it does not is `null`,
 * and an adapter must not send a `null` to its bank — for Banesco, sending the
 * date on a transferencia is precisely what makes the search fail.
 */
export type FindPaymentQuery = {
  readonly kind: PaymentKind;
  /** The digits the customer read off their receipt — see `referenceDigits`. */
  reference: string;
  /** Normalised by the domain to `584143125566`. Null where the kind has none. */
  payerPhone: string | null;
  /** The merchant's own receiving account, full. Null where the kind has none. */
  receivingAccount: string | null;
  /** Sudeban code of the payer's bank, four digits, e.g. `0134`. */
  sourceBankId: string;
  /** The day the payment was made, `YYYY-MM-DD` local. Null where unused. */
  onDate: string | null;
  /** Our cashier session id, forwarded so the bank's support can correlate. */
  sessionId: string;
};

/**
 * A found payment, plus which route found it. `strategy` is recorded on the
 * validation row: when one route starts carrying all the traffic, that is
 * worth knowing before a merchant reports it.
 */
export type FoundPayment = {
  movement: BankMovement;
  strategy: 'exact_reference' | 'reference_tail_and_phone' | 'reference_tail_and_account';
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
   * Which of those groups the counter authenticates with. One string, declared
   * once, so no stored row has to carry a "what is this pair for" flag and no
   * use case has to guess which of several pairs to open.
   */
  readonly operateKey: string;
  /**
   * The kinds of payment this bank can be asked about, and what each one takes.
   * The counter renders one form per entry and the selector beside "Validar
   * pago" is this list; a bank that only does pago móvil declares one, and its
   * selector disappears on its own.
   */
  readonly paymentKinds: readonly BankPaymentKind[];
  /**
   * The shape of a receiving account at this bank, or `null` if it never asks
   * for one. Read by the connect form, by the editor on a connected bank and by
   * the use case that stores them — one rule, three readers, no third spelling.
   */
  readonly receivingAccountRule: BankReceivingAccountRule | null;

  authenticate(
    environment: BankEnvironment,
    credentials: BankCredentials,
  ): Promise<Result<BankSession, BankFailure>>;

  /**
   * Finds the one payment matching the query, or `null` when the bank simply
   * has nothing yet. `null` is a success: it is an answer, not a fault.
   */
  findPayment(
    session: BankSession,
    query: FindPaymentQuery,
  ): Promise<Result<FoundPayment | null, BankFailure>>;
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
  /**
   * Print every request we make to the bank — method, path and body — to the
   * console. A local switch (`BANESCO_DEBUG=true` in `.dev.vars`), never on in
   * production: it exists to settle "are you actually sending us the phone and
   * the bank code?" by showing the wire.
   */
  debug: boolean;
};
