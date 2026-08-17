/**
 * The counter. A cashier types the last digits of a reference; we ask the bank
 * whether that pago móvil landed; only the bank's answer approves it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  Everything in the input is a claim. The only evidence in this file is the
 *  movement the bank returned, and every value that lands in `validations`
 *  comes from that movement — the reference, the amount, the currency, the
 *  instant. What was typed is used to *ask the question*, never to answer it.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Six things happen in a fixed order, and the order is the design:
 *
 *  1. **Idempotency first.** A retried submission returns the same validation
 *     and the same control code without the bank being asked again. A cashier
 *     on a bad connection tapping "confirmar" twice must not produce two
 *     questions, two answers, or two receipts.
 *  2. **The connection, then the secrets.** The cashier picked which of the
 *     company's banks receives; that connection decides which bank is asked,
 *     with whose credentials — unsealed here, used for one call, never logged
 *     and never returned.
 *  3. **Already charged? — on the claim's own key, before the bank.** The key a
 *     payment is charged under is a composition of what was typed (the
 *     reference tail and the day), so it can be built here. It is allowed to
 *     miss and never to hit falsely; step 6 says exactly why.
 *  4. **Then the bank is asked.** Nothing is concluded from the claim: six typed
 *     digits are a question, not an answer, and only the movement approves.
 *  5. **The verdict is the domain's.** `matchPayment` compares the movement
 *     against the claim. `ok(null)` from the gateway is *not_found* — "todavía
 *     no aparece", an answer with a *Reintentar* next to it — and a rejection
 *     writes no row at all.
 *  6. **The row is the charge.** It is keyed by `paymentKey` on the **bank's**
 *     reference, which is the key of record — the one in step 3 is that key
 *     predicted from the claim, and it is exact for a bank that answers with the
 *     tail it was asked with. Where the bank answers with more, the two differ,
 *     the prediction misses, and this one catches it. The unique indexes decide
 *     the rest: another cashier who already charged this payment wins, and our
 *     own control-code collision is redrawn.
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
import {
  fullestReference,
  matchPayment,
  paymentKey,
  type RejectionReason,
} from '../../domain/payment-match.ts';
import { normalisePhone } from '../../domain/phone.ts';
import { findBank } from '../../domain/sudeban.ts';
import { type Clock, venezuelaDate } from '../../shared/clock.ts';
import { unseal } from '../../shared/crypto.ts';
import { AppError, forbidden } from '../../shared/errors.ts';
import type { IdGen } from '../../shared/id.ts';
import { logger, maskReference } from '../../shared/logger.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { type AccountCredentials, operateCredential } from '../banking/account-credentials.ts';
import type {
  BankFailure,
  BankGateway,
  BankId,
  BankPaymentKind,
  FoundPayment,
  PaymentKind,
} from '../ports/bank-gateway.ts';

/** `YYYY-MM-DD`. The bank's `startDt` format, and the till's date field. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The day-half of a payment key for a kind that has no day. `paymentKey` folds
 * the date in only when the bank answers with a bare tail; where there is no
 * date at all, a bare tail is all the identity there is, and this constant says
 * so out loud instead of letting an empty string look like an oversight.
 */
const UNDATED = 'sin-fecha';

/**
 * The bounds on a whole reference. Wide on purpose: Banesco's are 11 and 12
 * digits, other banks will differ, and the only thing worth refusing here is a
 * value nobody could have read off a receipt.
 */
const MIN_FULL_REFERENCE = 6;
const MAX_FULL_REFERENCE = 20;

/** How many digits the question actually carried. See `paymentKey`. */
function askedDigits(reference: string): number {
  return reference.replace(/\D/g, '').length;
}

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
  listActiveForCompany(companyId: string): Promise<readonly BankAccount[]>;
};

type ValidationWriter = {
  findByIdempotencyKey(key: string): Promise<Validation | null>;
  /** The "already cobrado?" check, on the key the bank's answer produced. */
  findChargedPayment(
    bankAccountIds: readonly string[],
    referenceKey: string,
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
  /**
   * The digits the customer read off their receipt. How many of them the bank
   * wants is the bank's own `referenceDigits` — six for Banesco — and anything
   * longer is trimmed to that tail rather than refused, since the tail is what
   * the search uses either way.
   */
  readonly reference: string;
  /** Which of the bank's kinds this claim is. The till's selector. */
  readonly kind: PaymentKind;
  /** Required for a pago móvil, absent for a transferencia. */
  readonly payerPhone: string | null;
  /**
   * Which of the connection's registered receiving accounts the transferencia
   * landed in — the full 20 digits. Absent for a pago móvil, which never
   * carries one.
   */
  readonly receivingAccount: string | null;
  /** Sudeban code of the payer's bank, four digits. */
  readonly sourceBankId: string;
  readonly amountCents: number;
  /**
   * The day the customer made the payment, `YYYY-MM-DD` Venezuela local. The
   * till defaults it to today and lets the cashier move it back — a customer
   * who paid last night and turns up this morning was, until the bank asked for
   * this field, simply unfindable. Absent for a kind that does not take one.
   */
  readonly paymentDate: string | null;
  /** One per submission. A retry of the same submission reuses it. */
  readonly idempotencyKey: string;
  /**
   * Which of the company's bank connections receives — the counter's "banco
   * receptor". Scoped by `companyId`, so a tampered id reaches at worst this
   * company's own connection.
   */
  readonly bankAccountId: string;
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

/** What the request means once the domain has read it, for one kind. */
type Claim = {
  readonly kind: PaymentKind;
  /** Trimmed to the kind's `referenceDigits`. */
  readonly reference: string;
  /** Canonical E.164 `+584143125566`, or null where the kind takes no phone. */
  readonly payerPhone: string | null;
  /** The full receiving account, or null where the kind takes none. */
  readonly receivingAccount: string | null;
  readonly sourceBankId: string;
  readonly amountCents: number;
  /** `YYYY-MM-DD`, or null where the kind takes no date. */
  readonly paymentDate: string | null;
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

    // ── 1. idempotency ────────────────────────────────────────────────────
    const idempotencyKey = input.idempotencyKey.trim();
    if (idempotencyKey === '') return err('invalid_input');

    const replay = await validations.findByIdempotencyKey(idempotencyKey);
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

    // ── 2. the connection, then the secrets ───────────────────────────────
    // Scoped by company first and only then narrowed to the chosen id, so a
    // tampered `bankAccountId` finds nothing rather than another merchant's row.
    const usable = await accounts.listActiveForCompany(input.companyId);
    const account = usable.find((candidate) => candidate.id === input.bankAccountId) ?? null;
    if (account === null) {
      // Deliberately unrecorded: the metrics point is keyed by bank and
      // environment, and there is no bank in this story to attribute it to.
      logger.warn('validation_no_bank_account', {
        companyId: input.companyId,
        chosen: input.bankAccountId,
      });
      return err('no_bank_account');
    }

    const gateway = banks.get(account.bank);

    // What this kind takes is the bank's declaration, so a claim is read against
    // it rather than against a shape written here. A kind this bank does not
    // offer is a screen out of step with the catalogue, refused like any other
    // malformed claim.
    const spec = gateway.paymentKinds.find((candidate) => candidate.kind === input.kind) ?? null;
    if (spec === null) {
      logger.warn('validation_kind_unsupported', { bank: account.bank, kind: input.kind });
      return err('invalid_input');
    }

    const read = readClaim(input, spec, venezuelaDate(clock.nowSeconds()));
    if (!read.ok) return read;
    const claim = read.value;

    // One metric per attempt, attributed to the connection that was asked.
    const record = (point: {
      outcome: AttemptOutcome;
      strategy: SearchStrategy;
      bankStatus?: string | null;
      /** Only ever the bank's own figure, and only when a movement matched. */
      amountCents?: number;
    }): void => {
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

    // ── 3. already charged? the pre-flight, on the claim's own key ────────
    //
    // The key is a composition of what the cashier typed — the reference tail
    // and the day — so it can be built without asking anyone. For a bank that
    // answers with the tail it was asked with (Banesco does; verified against
    // five QA payments on 2026-08-11) this is *character for character* the key
    // the stored row carries, because the movement's date is the day that was
    // searched and its reference is the tail that was sent.
    //
    // Safe precisely because it can only be **wrong by missing**. A bank that
    // answers with the fuller reference stores its rows under that instead, so
    // this lookup finds nothing and the post-bank check below still catches it —
    // one wasted round trip, never a wrong answer. It cannot hit falsely: a row
    // under this exact key on this exact connection *is* this payment, by the
    // same definition `ux_validations_payment` enforces.
    //
    // What it buys is the counter's worst case: re-scanning a receipt that was
    // already cobrado now answers instantly instead of spending a bank round
    // trip in front of a customer to be told what the table already knew.
    // A kind with no date at all has nothing to pair a bare tail with, and its
    // key is then the canonical reference alone.
    //
    // The prediction is exact wherever the bank searches the day it was given —
    // every pago móvil, and an interbank transferencia. On a Banesco→Banesco
    // transferencia the date is collected but not sent, so a cashier who
    // re-scans the same receipt under a different day predicts a key the stored
    // row does not carry: a miss, one round trip, and the check after the bank
    // answers catches it. Missing is the only way this is allowed to be wrong.
    const claimKey = paymentKey({
      reference: claim.reference,
      occurredOn: claim.paymentDate ?? UNDATED,
      askedDigits: askedDigits(claim.reference),
    });
    const chargedBefore = await validations.findChargedPayment([account.id], claimKey);
    if (chargedBefore !== null) {
      record({
        outcome: 'already_charged',
        // No search happened — that is the difference from the check after the
        // bank answers, and it is what makes the two tellable apart in the data.
        strategy: 'none',
        amountCents: chargedBefore.amountCents,
      });
      logger.warn('payment_already_charged', {
        companyId: input.companyId,
        bank: account.bank,
        reference: maskReference(claim.reference),
        preflight: true,
      });
      return outcome({
        kind: 'already_charged',
        by: chargedBefore.cashierName ?? null,
        at: chargedBefore.createdAt,
      });
    }

    // ── 4. ask the bank ───────────────────────────────────────────────────
    // The counter runs on the operate pair — Banesco's Confirmación. Other
    // pairs, if a bank ever has any, have no business here.
    const secrets = await openCredentials(credsKey, account);
    const operate = operateCredential(secrets, gateway.operateKey);
    if (operate === null) {
      throw new AppError('internal', `bank account ${account.id} has no operate credentials`);
    }

    const session = await gateway.authenticate(account.environment, operate);
    if (!session.ok) {
      record({ outcome: 'bank_failure', strategy: 'none', bankStatus: session.error });
      return err(toCounterFailure(session.error));
    }

    const found = await gateway.findPayment(session.value, {
      kind: claim.kind,
      reference: claim.reference,
      payerPhone: claim.payerPhone,
      receivingAccount: claim.receivingAccount,
      sourceBankId: claim.sourceBankId,
      onDate: claim.paymentDate,
      sessionId: input.sessionId,
    });
    if (!found.ok) {
      record({ outcome: 'bank_failure', strategy: 'none', bankStatus: found.error });
      return err(toCounterFailure(found.error));
    }

    if (found.value === null) {
      record({ outcome: 'not_found', strategy: 'none' });
      logger.info('payment_not_found', {
        companyId: input.companyId,
        bank: account.bank,
        reference: maskReference(claim.reference),
      });
      return outcome({ kind: 'not_found' });
    }

    // ── 5. the verdict ────────────────────────────────────────────────────
    const payment: FoundPayment = found.value;
    const movement = payment.movement;
    const verdict = matchPayment({
      movement,
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
      record({ outcome: 'not_found', strategy: payment.strategy, bankStatus: reason });
      logger.info('payment_rejected', {
        companyId: input.companyId,
        bank: account.bank,
        reason,
        reference: maskReference(claim.reference),
      });
      return outcome(reason === null ? { kind: 'not_found' } : { kind: 'rejected', reason });
    }

    // ── 6. the row ────────────────────────────────────────────────────────
    // The identity of the payment, from the bank's answer and never from the
    // claim: its reference, or — when the bank echoes back only the digits it
    // was asked with — that tail plus the day the movement happened.
    const referenceKey = paymentKey({
      reference: movement.reference,
      occurredOn: spec.needsDate ? venezuelaDate(movement.occurredAt) : UNDATED,
      // What the cashier gave us, not what the kind declares: a transferencia is
      // typed whole and answered with the bank's own six-digit spelling, and it
      // is that comparison — answer against ask — that decides whether the reply
      // is a tail needing the day folded in. An adapter that trims further
      // before asking (Banesco does, on an interbank transferencia) only makes
      // this stricter, and a stricter key can miss but never collide.
      askedDigits: askedDigits(claim.reference),
    });

    // The same question again, now on the bank's own key. Usually identical to
    // the pre-flight one above and so a certain miss; it earns its round trip
    // for the bank that answers with a fuller reference than it was asked with,
    // whose rows are keyed on that instead and which the pre-flight cannot see.
    const existingCharge =
      referenceKey === claimKey
        ? null
        : await validations.findChargedPayment([account.id], referenceKey);
    if (existingCharge !== null) {
      record({
        outcome: 'already_charged',
        strategy: payment.strategy,
        amountCents: existingCharge.amountCents,
      });
      logger.warn('payment_already_charged', {
        companyId: input.companyId,
        bank: account.bank,
        reference: maskReference(movement.reference),
      });
      return outcome({
        kind: 'already_charged',
        by: existingCharge.cashierName ?? null,
        at: existingCharge.createdAt,
      });
    }

    const row = {
      // Minted once: a control-code collision redraws the code, not the row.
      id: ids.uuid(),
      companyId: input.companyId,
      cashierId: input.cashierId,
      bankAccountId: account.id,
      bank: account.bank,
      kind: claim.kind,
      // Copied from the connection, never joined back. Delete the sandbox
      // connection tomorrow and this row still knows it was a test.
      isSandbox: account.environment === 'sandbox',
      // The fuller of the two spellings, exactly as one of them arrived. Usually
      // the bank's — it answers a six-digit pago móvil question with the whole
      // eleven, and a charge printed with six digits is a charge nobody can
      // settle an argument with. But not always: a transferencia is asked with
      // the receipt's `00000150496` and Banesco answers `150496`, and storing
      // that would delete zeros the customer is looking at. Identity lives beside
      // it in `referenceKey`, which canonicalises either spelling to the same
      // thing.
      reference: fullestReference(movement.reference, claim.reference),
      referenceKey,
      // Equal to the claim by the verdict above; taken from the movement
      // because the movement is the evidence and the claim never was.
      amountCents: movement.amountCents,
      currency: movement.currency.trim().toUpperCase(),
      payerPhone: claim.payerPhone,
      // The payer's bank is the code the payment was *found* with, not the one
      // the reply echoes back. `bankId` is a field the search matches on — a
      // wrong bank answers `70001 · sin resultados`, never a movement — so a
      // movement in hand is the bank agreeing with what the cashier picked.
      // Banesco's own `sourceBankId` is a different fact: it came back '0134',
      // Banesco, on a pago móvil made from Banco de Venezuela, because it names
      // the bank whose books the movement sits in. Preferring it printed
      // "Banco emisor · Banesco" over a payment nobody at Banesco had made.
      sourceBankId: claim.sourceBankId,
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
        record({
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
      // the index refused the payment, not the code. The check above missed it
      // only because a second cashier committed in the same instant.
      if (written.outcome === 'duplicate_payment') {
        record({
          outcome: 'already_charged',
          strategy: payment.strategy,
          amountCents: movement.amountCents,
        });
        logger.warn('payment_already_charged', {
          companyId: input.companyId,
          bank: account.bank,
          reference: maskReference(row.reference),
        });
        const charged = await validations.findChargedPayment([account.id], referenceKey);
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

/** Nothing in here is a failure; the counter has a screen for each of them. */
function outcome(
  value: ValidatePaymentOutcome,
): Result<ValidatePaymentOutcome, ValidatePaymentFailure> {
  return ok(value);
}

/**
 * Reads the claim through the domain before a single byte reaches the bank,
 * **against the kind the bank declared**.
 *
 * Not defensive duplication of the HTTP layer's parsing: these are the rules
 * that make the question askable at all. A phone that is not a Venezuelan
 * mobile has no pago móvil wallet behind it, a Sudeban code that is not in the
 * table joins against nothing in `validations.source_bank_id`, a non-positive
 * amount is refused by the schema's own CHECK, and a date the bank will not
 * parse is a round trip spent to be told `VDE02`.
 *
 * A field the kind does not take is **dropped, not merely ignored**. That is
 * the difference that matters: a stale value left on the form by a cashier
 * switching tabs must not reach the wire, because Banesco answers "sin
 * resultados" to a request carrying a field that modality did not ask for. What
 * a kind *does* take always reaches the adapter, which is then free to withhold
 * it from its bank — the date of a Banesco→Banesco transferencia is collected
 * here and deliberately never sent.
 *
 * The reference is *trimmed*, not refused, when it is longer than the bank
 * asks for: a cashier who pasted the whole number gave us more than we needed,
 * and its tail is exactly the question. Shorter is a refusal — there is no way
 * to invent the digits that are missing.
 */
function readClaim(
  input: ValidatePaymentInput,
  spec: BankPaymentKind,
  today: string,
): Result<Claim, 'invalid_input'> {
  const digits = input.reference.replace(/\D/g, '');
  // A tail is an exact count the counter must have collected; a whole reference
  // is whatever the receipt says, bounded only enough to catch a slip of the
  // keyboard — Banesco's run 11 and 12 digits, and refusing one over the other
  // would turn a real payment away.
  const reference = spec.referenceDigits === null ? digits : digits.slice(-spec.referenceDigits);
  if (spec.referenceDigits === null) {
    if (reference.length < MIN_FULL_REFERENCE || reference.length > MAX_FULL_REFERENCE) {
      return err('invalid_input');
    }
  } else if (reference.length !== spec.referenceDigits) {
    return err('invalid_input');
  }

  if (findBank(input.sourceBankId) === null) return err('invalid_input');
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) {
    return err('invalid_input');
  }

  let payerPhone: string | null = null;
  if (spec.needsPayerPhone) {
    payerPhone = normalisePhone((input.payerPhone ?? '').trim());
    if (payerPhone === null) return err('invalid_input');
  }

  let receivingAccount: string | null = null;
  if (spec.needsReceivingAccount) {
    // The full number, because a masked one is refused by the bank with a 400.
    // The connection only ever stores completed numbers, so a claim that fails
    // this arrived from somewhere other than the picker.
    receivingAccount = (input.receivingAccount ?? '').replace(/\D/g, '');
    if (receivingAccount.length < 10 || receivingAccount.length > 24) return err('invalid_input');
  }

  let paymentDate: string | null = null;
  if (spec.needsDate) {
    paymentDate = (input.paymentDate ?? '').trim();
    // A payment cannot have happened tomorrow. The comparison is lexical, which
    // is the same as chronological for `YYYY-MM-DD`, and both sides are
    // Venezuela local — the counter's day, which is the one the cashier means.
    if (!ISO_DATE.test(paymentDate) || paymentDate > today) return err('invalid_input');
  }

  return ok({
    kind: spec.kind,
    reference,
    payerPhone,
    receivingAccount,
    sourceBankId: input.sourceBankId,
    amountCents: input.amountCents,
    paymentDate,
    idempotencyKey: input.idempotencyKey.trim(),
  });
}

/**
 * The credential map, in the clear for the length of one bank call.
 *
 * A row that will not open is not a decision the cashier can help with: the key
 * rotated without the row being re-sealed, or the bytes were tampered with.
 * Either way the connection is unusable and someone has to be told, which is
 * what an `AppError` is for.
 */
async function openCredentials(
  credsKey: string,
  account: BankAccount,
): Promise<AccountCredentials> {
  try {
    return await unseal<AccountCredentials>(credsKey, account.credentials);
  } catch {
    throw new AppError('internal', `bank account ${account.id} could not be unsealed`);
  }
}

/**
 * A bank's failure as the counter must state it.
 *
 * `rate_limited` is an onboarding-shaped answer arriving in front of a customer,
 * where the only true thing to say is that the bank did not answer.
 * `rejected_credentials` keeps its own code: it is the merchant's to fix in the
 * panel, and hiding it as "unavailable" would have them waiting for a bank that
 * is working fine.
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
