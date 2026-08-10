/**
 * The counter. A cashier types a reference; we ask the bank whether that
 * payment landed; only the bank's answer approves it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Everything in the input is a claim. The only evidence in this file is the
 *  movement the bank returned, and every value that lands in `validations`
 *  comes from that movement — the reference, the amount, the currency, the
 *  instant. What was typed is used to *ask the question*, never to answer it.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Four things happen in a fixed order, and the order is the design:
 *
 *  1. **Idempotency first.** A retried submission returns the same validation
 *     and the same control code without the bank being asked again. A cashier
 *     on a bad connection tapping "confirmar" twice must not produce two
 *     questions, two answers, or two receipts.
 *  2. **The account, then the secrets.** The company's active account for the
 *     environment decides which bank is asked and with whose credentials —
 *     unsealed here, used for one call, never logged and never returned.
 *  3. **The verdict is the domain's.** `matchPayment` compares the movement
 *     against the claim. `ok(null)` from the gateway is *not_found* — "todavía
 *     no aparece", an answer with a *Reintentar* next to it — and a rejection
 *     writes no row at all.
 *  4. **The row is the charge.** Approved payments are inserted with a control
 *     code, and the three unique indexes decide the rest: another cashier who
 *     already charged this reference wins, and our own control-code collision
 *     is redrawn.
 *
 * An attempt that finds nothing leaves no row anywhere, so the single metrics
 * data point recorded per attempt is the only trace it leaves at all — the
 * "todavía no aparece" rate is measurable there or nowhere.
 */
import type { BankAccount } from '../../adapters/d1/bank-account.repository.ts';
import type {
  InsertResult,
  NewValidation,
  Validation,
} from '../../adapters/d1/validation.repository.ts';
import type {
  AttemptOutcome,
  SearchStrategy,
  ValidationAttempt,
} from '../../adapters/metrics/attempt.metrics.ts';
import { CONTROL_CODE_MAX_ATTEMPTS, generateControlCode } from '../../domain/control-code.ts';
import { matchPayment, type RejectionReason } from '../../domain/payment-match.ts';
import { normalisePhone } from '../../domain/phone.ts';
import { findBank } from '../../domain/sudeban.ts';
import { type Clock, venezuelaDate } from '../../shared/clock.ts';
import { unseal } from '../../shared/crypto.ts';
import { AppError, forbidden } from '../../shared/errors.ts';
import type { IdGen } from '../../shared/id.ts';
import { logger, maskReference } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { type OpenedCredential, operateCredential } from '../banking/account-credentials.ts';
import type {
  BankCredentials,
  BankEnvironment,
  BankFailure,
  BankGateway,
  BankId,
  FoundPayment,
} from '../ports/bank-gateway.ts';

/**
 * The ports, declared here and structurally.
 *
 * Each is the slice of a collaborator this one use case consumes, so the
 * dependency is a shape rather than a class: the D1 repositories and
 * `BankRegistry` satisfy them, and a test satisfies them with an object literal
 * — which is why nothing in `validate-payment.test.ts` mocks one of our modules.
 * The row types are imported because they are the shared vocabulary; the
 * classes that produce them are not.
 */
type BankAccountReader = {
  listActiveForCompany(
    companyId: string,
    environment: BankEnvironment,
  ): Promise<readonly BankAccount[]>;
};

type ValidationWriter = {
  findByIdempotencyKey(key: string): Promise<Validation | null>;
  /** The pre-flight "already cobrado?" — a charge for this reference on one of
   *  these accounts, carrying the cashier's name. Answered before the bank. */
  findChargedPayment(
    bankAccountIds: readonly string[],
    reference: string,
  ): Promise<Validation | null>;
  insert(input: NewValidation): Promise<InsertResult>;
};

type BankAccess = {
  get(bank: BankId): BankGateway;
};

type AttemptRecorder = {
  record(attempt: ValidationAttempt): void;
};

export type ValidatePaymentDeps = {
  readonly accounts: BankAccountReader;
  readonly validations: ValidationWriter;
  readonly banks: BankAccess;
  readonly metrics: AttemptRecorder;
  readonly clock: Clock;
  readonly ids: IdGen;
  /** The AES-GCM master key, as a dependency. Never read from `env` in here. */
  readonly credsKey: string;
};

export type ValidatePaymentInput = {
  readonly companyId: string;
  readonly cashierId: string;
  /** The cashier's session, forwarded so the bank's support can correlate. */
  readonly sessionId: string;
  readonly reference: string;
  /**
   * Blank or `null` is not a missing field: it is a claim with no payer phone
   * behind it — a transferencia — and it is asked only of the banks that
   * declare `findsTransfers`. A phone that *was* typed still has to be a real
   * pago móvil number.
   */
  readonly payerPhone: string | null;
  /** Sudeban code of the payer's bank, four digits. */
  readonly sourceBankId: string;
  readonly amountCents: number;
  /** One per submission. A retry of the same submission reuses it. */
  readonly idempotencyKey: string;
  /** Which of the company's accounts answers. Production unless asked. */
  readonly environment?: BankEnvironment;
  /**
   * Scope the search to one of the company's accounts. Absent — the default —
   * asks every usable account for the environment in turn. Scoped by `companyId`
   * either way, so a tampered id reaches at worst this company's own account.
   */
  readonly accountId?: string;
};

/**
 * Every one of these is a `Result` *success*: they are all answers the counter
 * knows how to show. Only a bank that would not answer at all is a failure.
 */
export type ValidatePaymentOutcome =
  | { readonly kind: 'confirmed'; readonly validation: Validation }
  /** The bank does not report this payment yet. *Reintentar* / *Verificar datos*. */
  | { readonly kind: 'not_found' }
  /** The bank reports it, and it is not the payment that was claimed. */
  | { readonly kind: 'rejected'; readonly reason: RejectionReason }
  /** Another cashier charged this exact payment first — with who and when. */
  | { readonly kind: 'already_charged'; readonly by: string | null; readonly at: number };

export type ValidatePaymentFailure =
  | 'no_bank_account'
  | 'invalid_input'
  | 'rejected_credentials'
  | 'maintenance'
  | 'unavailable'
  | 'timeout';

export type ValidatePayment = (
  input: ValidatePaymentInput,
) => Promise<Result<ValidatePaymentOutcome, ValidatePaymentFailure>>;

/** What the request means once the domain has read it. */
type Claim = {
  readonly reference: string;
  /** Canonical `584143125566`, whatever the customer read out — or `null` for
   *  a transferencia, which has no phone to give. */
  readonly payerPhone: string | null;
  readonly sourceBankId: string;
  readonly amountCents: number;
  readonly idempotencyKey: string;
};

export function makeValidatePayment({
  accounts,
  validations,
  banks,
  metrics,
  clock,
  ids,
  credsKey,
}: ValidatePaymentDeps): ValidatePayment {
  return async (input) => {
    // Latency is measured from here rather than from the bank call: what the
    // dashboard has to answer is how long the cashier waited.
    const startedMs = clock.nowMillis();

    const read = readClaim(input);
    if (!read.ok) return read;
    const claim = read.value;

    // ── 1. idempotency ────────────────────────────────────────────────────
    const replay = await validations.findByIdempotencyKey(claim.idempotencyKey);
    if (replay !== null) {
      // The key is unique across the whole table, so a row under someone else's
      // company means the key was not minted by this caller.
      if (replay.companyId !== input.companyId) {
        throw forbidden('idempotency key belongs to another company');
      }
      // No metric: the attempt this replays was already counted, and counting
      // it again would inflate both the confirmed count and the amount in a
      // dataset whose entire job is a ratio.
      return outcome({ kind: 'confirmed', validation: replay });
    }

    // ── 2. the accounts, then the secrets ─────────────────────────────────
    const environment = input.environment ?? 'production';
    const usable = await accounts.listActiveForCompany(input.companyId, environment);
    // An explicit choice scopes to one account; otherwise the counter asks each
    // usable account in turn. A stale chosen id — the account was removed since
    // the till loaded — narrows to nothing and reads as "no account", the same
    // as none connected.
    const scoped = input.accountId ? usable.filter((a) => a.id === input.accountId) : usable;
    if (scoped.length === 0) {
      // Deliberately unrecorded: the metrics point is keyed by bank and
      // environment, and there is no bank in this story to attribute it to.
      logger.warn('validation_no_bank_account', { companyId: input.companyId, environment });
      return err('no_bank_account');
    }

    // A claim with no phone is a transferencia, and only a bank that can find
    // one may be asked about it — anywhere else the question has no answer, and
    // asking it anyway spends a round trip at the counter to be told nothing.
    // The till keeps the field required for such a bank, so reaching this is
    // either a second bank connected since the screen loaded or a hand-made
    // request; both get the same refusal rather than a false "no aparece".
    const candidates =
      claim.payerPhone === null
        ? scoped.filter((account) => banks.get(account.bank).findsTransfers)
        : scoped;
    if (candidates.length === 0) {
      logger.warn('validation_phone_required', { companyId: input.companyId, environment });
      return err('invalid_input');
    }

    // One metric per attempt. The loop below finds the account the bank reports
    // the movement on (or the last bank that would not answer), and the single
    // point is recorded once, after — attributed to that account.
    const record = (
      account: BankAccount,
      point: {
        outcome: AttemptOutcome;
        strategy: SearchStrategy;
        bankStatus?: string | null;
        /** Only ever the bank's own figure, and only when a movement matched. */
        amountCents?: number;
      },
    ): void => {
      metrics.record({
        companyId: input.companyId,
        bank: account.bank,
        environment: account.environment,
        searchStrategy: point.strategy,
        outcome: point.outcome,
        bankStatus: point.bankStatus ?? null,
        latencyMs: clock.nowMillis() - startedMs,
        amountCents: point.amountCents ?? 0,
      });
    };

    // ── already charged? the pre-flight check ─────────────────────────────
    // Before a single bank call: if this reference is already a charge on one
    // of these accounts, answer now. Re-scanning a cobrado payment must not
    // spend a bank round trip at the counter to be told what the table already
    // knows — and the answer carries who charged it and when.
    const existingCharge = await validations.findChargedPayment(
      candidates.map((a) => a.id),
      claim.reference,
    );
    if (existingCharge !== null) {
      const account =
        candidates.find((a) => a.id === existingCharge.bankAccountId) ?? candidates[0];
      record(account, {
        outcome: 'already_charged',
        strategy: 'none',
        amountCents: existingCharge.amountCents,
      });
      logger.warn('payment_already_charged', {
        companyId: input.companyId,
        reference: maskReference(claim.reference),
      });
      return outcome({
        kind: 'already_charged',
        by: existingCharge.cashierName ?? null,
        at: existingCharge.createdAt,
      });
    }

    // Walk the accounts until one reports the movement. A payment lands in a
    // single receiving account, so at most one answers with a movement and the
    // rest answer null; the first hit wins and the loop stops — no extra round
    // trips at the counter once the payment is found. A bank that will not
    // answer at all is remembered, and surfaced only if no account has the
    // payment: a bank being down outranks "todavía no aparece".
    let deciding: { account: BankAccount; payment: FoundPayment } | null = null;
    let failure: { account: BankAccount; error: BankFailure } | null = null;

    for (const account of candidates) {
      const secrets = await openAccount(credsKey, account);
      const gateway = banks.get(account.bank);

      // The counter runs on the operate pair — Banesco's Confirmación. A bank
      // with a single stored pair uses it whatever its usage; the other pairs,
      // if any, only listed accounts at onboarding and have no business here.
      const operate = operateCredential(secrets.credentials);
      if (operate === null) {
        throw new AppError('internal', `bank account ${account.id} has no operate credentials`);
      }

      const session = await gateway.authenticate(account.environment, operate);
      if (!session.ok) {
        failure = { account, error: session.error };
        continue;
      }

      const found = await gateway.findPayment(session.value, {
        accountId: secrets.accountNumber,
        reference: claim.reference,
        payerPhone: claim.payerPhone,
        sourceBankId: claim.sourceBankId,
        onDate: venezuelaDate(clock.nowSeconds()),
        sessionId: input.sessionId,
      });
      if (!found.ok) {
        failure = { account, error: found.error };
        continue;
      }

      if (found.value !== null) {
        deciding = { account, payment: found.value };
        break;
      }
    }

    // ── 3. the verdict ────────────────────────────────────────────────────
    if (deciding === null) {
      if (failure !== null) {
        record(failure.account, {
          outcome: 'bank_failure',
          strategy: 'none',
          bankStatus: failure.error,
        });
        return err(toCounterFailure(failure.error));
      }
      record(candidates[0], { outcome: 'not_found', strategy: 'none' });
      logger.info('payment_not_found', {
        companyId: input.companyId,
        reference: maskReference(claim.reference),
      });
      return outcome({ kind: 'not_found' });
    }

    const { account, payment } = deciding;
    const verdict = matchPayment({
      movement: payment.movement,
      expected: { reference: claim.reference, amountCents: claim.amountCents },
      now: clock.nowSeconds(),
    });

    if (verdict.kind !== 'approved') {
      // `matchPayment` only answers 'not_found' for a null movement, which the
      // guard above already returned, so anything here is a rejection — but the
      // union is honoured rather than asserted away.
      const reason = verdict.kind === 'rejected' ? verdict.reason : null;
      // The outcome column carries "not confirmed" and the strategy carries
      // "yet a movement was found", which is how a rejection stays visible in
      // the dataset without inventing a code the schema does not have:
      // `outcome = 'not_found' AND search_strategy <> 'none'` is exactly the
      // set of attempts where the bank had a movement and it did not match.
      record(account, { outcome: 'not_found', strategy: payment.strategy, bankStatus: reason });
      logger.info('payment_rejected', {
        companyId: input.companyId,
        bank: account.bank,
        reason,
        reference: maskReference(claim.reference),
      });
      return outcome(reason === null ? { kind: 'not_found' } : { kind: 'rejected', reason });
    }

    // ── 4. the row ────────────────────────────────────────────────────────
    const movement = payment.movement;
    const row = {
      // Minted once: a control-code collision redraws the code, not the row.
      id: ids.uuid(),
      companyId: input.companyId,
      cashierId: input.cashierId,
      bankAccountId: account.id,
      bank: account.bank,
      // Copied from the account, never joined back. Delete the sandbox account
      // tomorrow and this row still knows it was a test.
      isSandbox: account.environment === 'sandbox',
      // The reference exactly as it was typed, zeros and all: it is what the
      // customer's receipt says, and a charge a customer cannot find on their
      // phone is a charge nobody can settle an argument with. The banks do not
      // agree on the padding — Banesco answers '00000150496' as '150496' and
      // pads others the other way — so the *identity* of the payment cannot live
      // in this column. It lives in `reference_key` beside it, which the
      // repository derives with the domain's `canonicalReference` and which
      // `ux_validations_payment` is unique over: two spellings of one payment
      // still collide, and the anti-double-charge mechanism is untouched.
      reference: claim.reference,
      // Equal to the claim by the verdict above; taken from the movement
      // because the movement is the evidence and the claim never was.
      amountCents: movement.amountCents,
      currency: movement.currency.trim().toUpperCase(),
      payerPhone: claim.payerPhone,
      // The bank knows who paid it better than the picker does: a customer who
      // chose the wrong bank on the screen still made the payment the bank
      // reports. But only when what it reports *names a bank* — Banesco returns
      // its own two-digit `01` for its own customers, which pads to '0001' and
      // is no Sudeban code at all. Storing that would put a number nothing can
      // resolve where the payer's bank belongs, and the counter would print it
      // raw beside the charge. An unrecognisable code is not better information
      // than the one the cashier picked off the receipt.
      sourceBankId: reportedBank(movement.sourceBankId) ?? claim.sourceBankId,
      trnAt: movement.occurredAt,
      searchMode: payment.strategy,
      idempotencyKey: claim.idempotencyKey,
      createdAt: clock.nowSeconds(),
    };

    for (let draw = 1; draw <= CONTROL_CODE_MAX_ATTEMPTS; draw++) {
      const written = await validations.insert({
        ...row,
        controlCode: generateControlCode(ids),
        latencyMs: clock.nowMillis() - startedMs,
      });

      if (written.outcome === 'inserted') {
        record(account, {
          outcome: 'confirmed',
          strategy: payment.strategy,
          amountCents: movement.amountCents,
        });
        logger.info('payment_confirmed', {
          companyId: input.companyId,
          bank: account.bank,
          isSandbox: row.isSandbox,
          controlCode: written.validation.controlCode,
          reference: maskReference(row.reference),
        });
        return outcome({ kind: 'confirmed', validation: written.validation });
      }

      // Another cashier charged this payment first. There is nothing to retry:
      // the index refused the payment, not the code.
      if (written.outcome === 'duplicate_payment') {
        record(account, {
          outcome: 'already_charged',
          strategy: payment.strategy,
          amountCents: movement.amountCents,
        });
        logger.warn('payment_already_charged', {
          companyId: input.companyId,
          bank: account.bank,
          reference: maskReference(row.reference),
        });
        // The pre-check missed it — the bank padded the reference differently,
        // or a second cashier committed in the same instant. Read who charged
        // it on the bank's canonical reference so the counter can still say so.
        const charged = await validations.findChargedPayment([account.id], row.reference);
        return outcome({
          kind: 'already_charged',
          by: charged?.cashierName ?? null,
          at: charged?.createdAt ?? clock.nowSeconds(),
        });
      }

      // The same submission arriving twice, close enough together that the
      // first one had not committed when we looked. It is the same answer as an
      // idempotent replay and it is not counted twice either.
      if (written.outcome === 'idempotent_replay') {
        const existing = await validations.findByIdempotencyKey(claim.idempotencyKey);
        if (existing === null) {
          throw new AppError('internal', 'idempotency index refused a row that does not exist');
        }
        return outcome({ kind: 'confirmed', validation: existing });
      }

      logger.warn('control_code_collision', { companyId: input.companyId, draw });
    }

    // Our own six digits lost three draws in one company. The bank confirmed a
    // payment we could not write down, which is an alert and not a message for
    // the customer — and the 500 in Workers Logs is its trace, because the
    // metrics vocabulary has no code for "the code space is too small".
    throw new AppError(
      'internal',
      `control code collided ${CONTROL_CODE_MAX_ATTEMPTS} times for ${input.companyId}`,
    );
  };
}

/** The bank's own code for the payer's bank, if it is one we can name. */
function reportedBank(sourceBankId: string | null): string | null {
  return sourceBankId !== null && findBank(sourceBankId) !== null ? sourceBankId : null;
}

/** Nothing in here is a failure; the counter has a screen for each of them. */
function outcome(
  value: ValidatePaymentOutcome,
): Result<ValidatePaymentOutcome, ValidatePaymentFailure> {
  return ok(value);
}

/**
 * Reads the claim through the domain before a single byte reaches the bank.
 *
 * Not defensive duplication of the HTTP layer's parsing: these are the rules
 * that make the question askable at all. A phone that is not a Venezuelan
 * mobile has no pago móvil wallet behind it, a Sudeban code that is not in the
 * table joins against nothing in `validations.source_bank_id`, and a
 * non-positive amount is refused by the schema's own CHECK — asking the bank
 * any of those questions spends a round trip to be told no.
 *
 * The one field that may be absent is the phone, and absent is a *meaning*
 * rather than a gap: no phone is a transferencia. It is only the typed-and-
 * wrong phone that is refused here — a blank one is a different question, not
 * a broken one.
 */
function readClaim(input: ValidatePaymentInput): Result<Claim, 'invalid_input'> {
  const reference = input.reference.trim();
  const idempotencyKey = input.idempotencyKey.trim();
  const typedPhone = input.payerPhone?.trim() ?? '';
  const payerPhone = typedPhone === '' ? null : normalisePhone(typedPhone);

  if (reference === '' || idempotencyKey === '') return err('invalid_input');
  if (typedPhone !== '' && payerPhone === null) return err('invalid_input');
  if (findBank(input.sourceBankId) === null) return err('invalid_input');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return err('invalid_input');
  }

  return ok({
    reference,
    payerPhone,
    sourceBankId: input.sourceBankId,
    amountCents: input.amountCents,
    idempotencyKey,
  });
}

/**
 * The credentials and the account number, in the clear for the length of one
 * bank call.
 *
 * A row that will not open is not a decision the cashier can help with: the key
 * rotated without the row being re-sealed, or the bytes were tampered with.
 * Either way the account is unusable and someone has to be told, which is what
 * an `AppError` is for.
 */
async function openAccount(
  credsKey: string,
  account: BankAccount,
): Promise<{ credentials: OpenedCredential[]; accountNumber: string }> {
  try {
    // Only the credential pairs are sealed now; the account number is stored in
    // the clear (§6), so it comes straight off the row.
    const credentials = await Promise.all(
      account.credentials.map(async (stored) => ({
        credKey: stored.credKey,
        usage: stored.usage,
        credentials: await unseal<BankCredentials>(credsKey, stored.credentials),
      })),
    );
    return { credentials, accountNumber: account.accountNumber };
  } catch {
    throw new AppError('internal', `bank account ${account.id} could not be unsealed`);
  }
}

/**
 * A bank's failure as the counter must state it.
 *
 * `no_accounts` and `rate_limited` are onboarding-shaped answers arriving in
 * front of a customer, where the only true thing to say is that the bank did
 * not answer. `rejected_credentials` keeps its own code: it is the merchant's
 * to fix in the panel, and hiding it as "unavailable" would have them waiting
 * for a bank that is working fine.
 */
function toCounterFailure(failure: BankFailure): ValidatePaymentFailure {
  switch (failure) {
    case 'maintenance':
    case 'timeout':
    case 'rejected_credentials':
    case 'invalid_input':
      return failure;
    default:
      return 'unavailable';
  }
}
