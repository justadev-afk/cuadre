import { describe, expect, it } from 'vitest';

import type { BankAccount } from '../../adapters/d1/bank-account.repository.ts';
import type {
  InsertResult,
  NewValidation,
  Validation,
} from '../../adapters/d1/validation.repository.ts';
import type { ValidationAttempt } from '../../adapters/metrics/attempt.metrics.ts';
import { type Clock, fixedClock } from '../../shared/clock.ts';
import { seal } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
import { fakeIdGen } from '../../shared/id.ts';
import { ok, type Result } from '../../shared/result.ts';
import type {
  BankFailure,
  BankGateway,
  BankMovement,
  BankSession,
  FindPaymentQuery,
  FoundPayment,
} from '../ports/bank-gateway.ts';
import { makeValidatePayment, type ValidatePaymentInput } from './validate-payment.ts';

const NOW = 1_770_000_000;
/** `venezuelaDate(NOW)` — the counter's today, and the date field's default. */
const TODAY = '2026-02-01';
const CREDS_KEY = 'a-test-master-key-of-at-least-32-bytes';
const COMPANY = 'la-espiga';

const CREDENTIALS = {
  clientId: 'cuadre-qa-client',
  clientSecret: 'super-secret-value',
};

const SESSION: BankSession = {
  bank: 'banesco',
  environment: 'production',
  correlationId: 'correlation-1',
};

/**
 * The counter's claim. The reference is the **last six digits** — all Banesco
 * asks for, and all the till now collects.
 */
const INPUT: ValidatePaymentInput = {
  companyId: COMPANY,
  cashierId: 'user-maria',
  sessionId: 'session-1',
  kind: 'pago_movil',
  reference: '456789',
  payerPhone: '0414-3125566',
  receivingAccount: null,
  sourceBankId: '0134',
  amountCents: 124_000,
  paymentDate: TODAY,
  idempotencyKey: 'idem-1',
  bankAccountId: 'account-1',
};

function movement(overrides: Partial<BankMovement> = {}): BankMovement {
  return {
    reference: '000123456789',
    amountCents: 124_000,
    currency: 'BS ',
    accountMasked: '1340************8514',
    occurredAt: NOW - 300,
    sourceBankId: '0134',
    concept: 'Pago Movil',
    beneficiaryId: 'J-12345678-9',
    isCredit: true,
    ...overrides,
  };
}

const found = (over: Partial<BankMovement> = {}): FoundPayment => ({
  movement: movement(over),
  strategy: 'reference_tail_and_phone',
});

async function bankAccount(overrides: Partial<BankAccount> = {}): Promise<BankAccount> {
  return {
    id: 'account-1',
    companyId: COMPANY,
    bank: 'banesco',
    environment: 'production',
    label: 'Caja principal',
    receivingAccounts: [],
    clientIdLast6: 'client',
    credentials: await seal(CREDS_KEY, { main: CREDENTIALS }),
    verifiedAt: NOW - 86_400,
    credsExpireAt: null,
    status: 'active',
    createdAt: NOW - 86_400,
    ...overrides,
  };
}

function storedValidation(overrides: Partial<Validation> = {}): Validation {
  return {
    id: 'validation-0',
    companyId: COMPANY,
    cashierId: 'user-maria',
    bankAccountId: 'account-1',
    bank: 'banesco',
    kind: 'pago_movil',
    isSandbox: false,
    controlCode: '111111',
    reference: '000123456789',
    referenceKey: '123456789',
    amountCents: 124_000,
    currency: 'BS',
    payerPhone: '+584143125566',
    sourceBankId: '0134',
    trnAt: NOW - 300,
    latencyMs: 420,
    searchMode: 'reference_tail_and_phone',
    idempotencyKey: 'idem-1',
    createdAt: NOW - 60,
    ...overrides,
  };
}

/**
 * The three unique indexes, in memory. A fake that did not enforce them would
 * pass every test in this file while the real table refused the same rows.
 */
function fakeValidations(seed: readonly Validation[] = [], racing: readonly Validation[] = []) {
  const rows: Validation[] = [...seed];
  const takenControlCodes = new Set<string>();
  const inserts: NewValidation[] = [];
  /**
   * Rows that commit *between* the last check and our INSERT — the race the
   * unique index exists for. They land at the moment of writing, so every
   * lookup before it honestly answers "not charged yet" and only the index
   * catches them. Checking first and inserting second is the bug; this is how a
   * test gets to see the index do the arbitrating.
   */
  let pending: readonly Validation[] = racing;

  return {
    rows,
    inserts,
    takenControlCodes,

    async findByIdempotencyKey(key: string): Promise<Validation | null> {
      return rows.find((row) => row.idempotencyKey === key) ?? null;
    },

    async findChargedPayment(
      bankAccountIds: readonly string[],
      referenceKey: string,
    ): Promise<Validation | null> {
      // Matched on the key exactly, as the index is.
      return (
        rows.find(
          (row) => row.referenceKey === referenceKey && bankAccountIds.includes(row.bankAccountId),
        ) ?? null
      );
    },

    async insert(input: NewValidation): Promise<InsertResult> {
      inserts.push(input);
      // The other cashier's commit lands here — after every check this request
      // made, which is the only place a race can actually happen.
      rows.push(...pending);
      pending = [];

      if (rows.some((row) => row.idempotencyKey === input.idempotencyKey)) {
        return { outcome: 'idempotent_replay' };
      }
      // Unique over (bank_account_id, reference_key), exactly as the table is.
      if (
        rows.some(
          (row) =>
            row.bankAccountId === input.bankAccountId && row.referenceKey === input.referenceKey,
        )
      ) {
        return { outcome: 'duplicate_payment' };
      }
      if (
        takenControlCodes.has(input.controlCode) ||
        rows.some(
          (row) => row.companyId === input.companyId && row.controlCode === input.controlCode,
        )
      ) {
        return { outcome: 'control_code_taken' };
      }

      rows.push(input);
      return { outcome: 'inserted', validation: input };
    },
  };
}

const PAGO_MOVIL = {
  kind: 'pago_movil',
  label: 'Pago móvil',
  referenceDigits: 6,
  needsPayerPhone: true,
  needsReceivingAccount: false,
  needsDate: true,
} as const;

const TRANSFERENCIA = {
  kind: 'transferencia',
  label: 'Transferencia',
  referenceDigits: 6,
  needsPayerPhone: false,
  needsReceivingAccount: true,
  needsDate: false,
} as const;

type GatewayScript = {
  authenticate?: Result<BankSession, BankFailure>;
  payment?: Result<FoundPayment | null, BankFailure>;
  /** A bank that asks for a different slice of the reference. */
  referenceDigits?: number;
};

function fakeBanks(script: GatewayScript = {}) {
  const calls = { authenticate: 0, findPayment: 0 };
  const queries: FindPaymentQuery[] = [];

  const gateway: BankGateway = {
    id: 'banesco',
    displayName: 'Banesco',
    environments: ['production', 'sandbox'],
    credentialGroups: [{ key: 'main', label: 'Principal', required: true, fields: [] }],
    operateKey: 'main',
    receivingAccountRule: null,
    paymentKinds: [
      { ...PAGO_MOVIL, referenceDigits: script.referenceDigits ?? 6 },
      { ...TRANSFERENCIA, referenceDigits: script.referenceDigits ?? 6 },
    ],

    async authenticate() {
      calls.authenticate++;
      return script.authenticate ?? ok(SESSION);
    },
    async findPayment(_session, query) {
      calls.findPayment++;
      queries.push(query);
      return script.payment ?? ok(null);
    },
  };

  return { banks: { get: () => gateway }, calls, queries };
}

function fakeMetrics() {
  const points: ValidationAttempt[] = [];
  return {
    points,
    metrics: {
      record(point: ValidationAttempt) {
        points.push(point);
      },
    },
  };
}

/** Advances on every read, so a latency is a real difference of two instants. */
function steppingClock(seconds: number, stepMs: number): Clock {
  let millis = seconds * 1000;
  return {
    nowSeconds: () => seconds,
    nowMillis: () => {
      millis += stepMs;
      return millis;
    },
  };
}

async function harness(
  options: {
    script?: GatewayScript;
    account?: Partial<BankAccount> | null;
    seed?: readonly Validation[];
    /** Rows another cashier commits between the charged check and our insert. */
    racing?: readonly Validation[];
    digits?: string[];
    clock?: Clock;
  } = {},
) {
  const account = options.account === null ? null : await bankAccount(options.account ?? {});
  const validations = fakeValidations(options.seed, options.racing);
  const { banks, calls, queries } = fakeBanks(options.script);
  const { metrics, points } = fakeMetrics();

  const validatePayment = makeValidatePayment({
    accounts: {
      async listActiveForCompany(companyId: string) {
        if (account === null || companyId !== account.companyId) return [];
        return [account];
      },
    },
    validations,
    banks,
    metrics,
    clock: options.clock ?? fixedClock(NOW),
    ids: fakeIdGen({ uuids: ['validation-1'], digits: options.digits ?? ['654321'] }),
    credsKey: CREDS_KEY,
  });

  return { validatePayment, validations, calls, queries, points, account };
}

describe('validate payment', () => {
  it('confirms from the bank movement, not from what was typed', async () => {
    const { validatePayment, validations, points } = await harness({
      script: { payment: ok(found()) },
    });

    const result = await validatePayment(INPUT);

    expect(result).toEqual({
      ok: true,
      value: { kind: 'confirmed', validation: validations.rows[0] },
    });
    expect(validations.rows).toHaveLength(1);
    expect(validations.rows[0]).toMatchObject({
      id: 'validation-1',
      controlCode: '654321',
      amountCents: 124_000,
      currency: 'BS',
      trnAt: NOW - 300,
      searchMode: 'reference_tail_and_phone',
      // Normalised by the domain on the way in, whatever the customer read out.
      payerPhone: '+584143125566',
      createdAt: NOW,
    });
    expect(points).toEqual([
      {
        companyId: COMPANY,
        bank: 'banesco',
        environment: 'production',
        searchStrategy: 'reference_tail_and_phone',
        outcome: 'confirmed',
        bankStatus: null,
        latencyMs: 0,
        amountCents: 124_000,
      },
    ]);
  });

  it('records the reference the BANK reported, not the six digits typed', async () => {
    // The cashier types a tail; the bank knows the whole number and so does the
    // customer's receipt. A charge printed with six digits is a charge nobody
    // can settle an argument with.
    const { validatePayment, validations } = await harness({
      script: { payment: ok(found()) },
    });

    await validatePayment(INPUT);

    expect(validations.rows[0]?.reference).toBe('000123456789');
    expect(validations.rows[0]?.referenceKey).toBe('123456789');
  });

  it('keys a bank that echoes back only the tail on the tail AND the day', async () => {
    // Six digits are not an identifier — two customers a week apart can share
    // them. Pairing with the movement's own date is the narrowest thing that is
    // still true.
    const { validatePayment, validations } = await harness({
      script: { payment: ok(found({ reference: '456789' })) },
    });

    await validatePayment(INPUT);

    expect(validations.rows[0]?.referenceKey).toBe(`456789@${TODAY}`);
  });

  it('answers already-charged without a bank call, on the claim’s own key', async () => {
    // The key is a composition of what was typed — tail plus day — so for a bank
    // that answers with the tail it was asked with it is character for character
    // the key on the row. Re-scanning a cobrado receipt must not spend a round
    // trip in front of a customer to be told what the table already knows.
    const { validatePayment, validations, calls, points } = await harness({
      seed: [
        storedValidation({
          idempotencyKey: 'idem-0',
          controlCode: '999999',
          referenceKey: `456789@${TODAY}`,
          cashierName: 'María Rodríguez',
          createdAt: NOW - 120,
        }),
      ],
      script: { payment: ok(found()) },
    });

    const result = await validatePayment(INPUT);

    expect(calls.authenticate).toBe(0);
    expect(calls.findPayment).toBe(0);
    expect(result).toEqual({
      ok: true,
      value: { kind: 'already_charged', by: 'María Rodríguez', at: NOW - 120 },
    });
    expect(validations.inserts).toHaveLength(0);
    expect(validations.rows).toHaveLength(1);
    // No search happened, and the metric says so.
    expect(points[0]).toMatchObject({
      outcome: 'already_charged',
      searchStrategy: 'none',
      amountCents: 124_000,
    });
  });

  it('still catches it after the bank when the bank answers with more', async () => {
    // The prediction misses here — the row is keyed on the full reference the
    // bank reported, which the claim's six digits cannot produce — so the check
    // after the movement arrives is what refuses the second charge.
    const { validatePayment, validations, calls, points } = await harness({
      seed: [
        storedValidation({
          idempotencyKey: 'idem-0',
          controlCode: '999999',
          referenceKey: '123456789',
          cashierName: 'María Rodríguez',
          createdAt: NOW - 120,
        }),
      ],
      script: { payment: ok(found()) },
    });

    const result = await validatePayment(INPUT);

    expect(calls.findPayment).toBe(1);
    expect(result).toEqual({
      ok: true,
      value: { kind: 'already_charged', by: 'María Rodríguez', at: NOW - 120 },
    });
    expect(validations.inserts).toHaveLength(0);
    expect(points[0]).toMatchObject({
      outcome: 'already_charged',
      searchStrategy: 'reference_tail_and_phone',
    });
  });

  it('never refuses a payment the pre-flight has no row for', async () => {
    // The prediction may only be wrong by missing. A different payment sharing
    // neither tail nor day must reach the bank untouched.
    const { validatePayment, calls } = await harness({
      seed: [
        storedValidation({
          idempotencyKey: 'idem-0',
          controlCode: '999999',
          referenceKey: `456789@2026-01-30`,
        }),
      ],
      script: { payment: ok(found()) },
    });

    expect(await validatePayment(INPUT)).toMatchObject({
      ok: true,
      value: { kind: 'confirmed' },
    });
    expect(calls.findPayment).toBe(1);
  });

  it('refuses a second charge for the same payment however the bank padded it', async () => {
    // The identity lives in `reference_key`, so '150496' and '00000150496' from
    // the same bank collide — the whole anti-double-charge mechanism.
    const { validatePayment, validations } = await harness({
      seed: [
        storedValidation({
          reference: '150496',
          referenceKey: '150496',
          idempotencyKey: 'idem-earlier',
        }),
      ],
      script: { payment: ok(found({ reference: '00000150496' })) },
    });

    // Keyed on the full reference, so the pre-flight misses and the bank is
    // asked; the check on its answer is what refuses this.
    const result = await validatePayment({ ...INPUT, reference: '150496' });

    expect(result).toMatchObject({ ok: true, value: { kind: 'already_charged' } });
    expect(validations.rows).toHaveLength(1);
  });

  it('replays an idempotent submission without asking the bank', async () => {
    const first = storedValidation({ controlCode: '424242' });
    const { validatePayment, validations, calls, points } = await harness({
      seed: [first],
      script: { payment: ok(found()) },
    });

    const result = await validatePayment(INPUT);

    expect(result).toEqual({ ok: true, value: { kind: 'confirmed', validation: first } });
    expect(calls.authenticate).toBe(0);
    expect(calls.findPayment).toBe(0);
    expect(validations.rows).toHaveLength(1);
    // The replayed attempt was counted the first time round.
    expect(points).toEqual([]);
  });

  it('refuses an idempotency key that belongs to another company', async () => {
    const { validatePayment } = await harness({
      seed: [storedValidation({ companyId: 'otra-empresa' })],
    });

    await expect(validatePayment(INPUT)).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('answers not_found when the bank does not report the payment yet', async () => {
    const { validatePayment, validations, points } = await harness({
      script: { payment: ok(null) },
    });

    const result = await validatePayment(INPUT);

    expect(result).toEqual({ ok: true, value: { kind: 'not_found' } });
    expect(validations.rows).toHaveLength(0);
    expect(validations.inserts).toHaveLength(0);
    expect(points[0]).toMatchObject({
      outcome: 'not_found',
      searchStrategy: 'none',
      bankStatus: null,
      amountCents: 0,
    });
  });

  it('rejects an amount that does not match, and writes no row', async () => {
    const { validatePayment, validations, points } = await harness({
      script: { payment: ok(found({ amountCents: 123_999 })) },
    });

    const result = await validatePayment(INPUT);

    expect(result).toEqual({ ok: true, value: { kind: 'rejected', reason: 'amount_mismatch' } });
    expect(validations.rows).toHaveLength(0);
    expect(validations.inserts).toHaveLength(0);
    // A movement was found and did not match: outcome 'not_found' with a
    // strategy that is not 'none' is exactly that set.
    expect(points[0]).toMatchObject({
      outcome: 'not_found',
      searchStrategy: 'reference_tail_and_phone',
      bankStatus: 'amount_mismatch',
      amountCents: 0,
    });
  });

  it('rejects a debit, and writes no row', async () => {
    const { validatePayment, validations } = await harness({
      script: { payment: ok(found({ isCredit: false })) },
    });

    const result = await validatePayment(INPUT);

    expect(result).toEqual({ ok: true, value: { kind: 'rejected', reason: 'not_a_credit' } });
    expect(validations.rows).toHaveLength(0);
  });

  it('rejects a currency it does not settle', async () => {
    const { validatePayment, validations } = await harness({
      script: { payment: ok(found({ currency: 'USD' })) },
    });

    const result = await validatePayment(INPUT);

    expect(result).toEqual({
      ok: true,
      value: { kind: 'rejected', reason: 'unsupported_currency' },
    });
    expect(validations.rows).toHaveLength(0);
  });

  it('names who charged a payment that landed between the check and the insert', async () => {
    const { validatePayment, validations, points } = await harness({
      // Another cashier commits this exact payment after our check has already
      // answered "not charged yet". The unique index is what stops the second
      // charge, and the counter still reads back who took the first.
      racing: [
        storedValidation({
          idempotencyKey: 'idem-0',
          controlCode: '999999',
          cashierName: 'María Rodríguez',
        }),
      ],
      script: { payment: ok(found()) },
    });

    const result = await validatePayment(INPUT);

    expect(result).toEqual({
      ok: true,
      value: { kind: 'already_charged', by: 'María Rodríguez', at: NOW - 60 },
    });
    expect(validations.inserts).toHaveLength(1);
    expect(validations.rows).toHaveLength(1);
    expect(points[0]).toMatchObject({ outcome: 'already_charged', amountCents: 124_000 });
  });

  it('redraws the control code when the one it drew is taken', async () => {
    const { validatePayment, validations } = await harness({
      script: { payment: ok(found()) },
      digits: ['111111', '222222'],
    });
    validations.takenControlCodes.add('111111');

    const result = await validatePayment(INPUT);

    expect(result.ok).toBe(true);
    expect(validations.inserts.map((row) => row.controlCode)).toEqual(['111111', '222222']);
    // The row keeps its identity across the redraw; only the code changes.
    expect(validations.inserts.every((row) => row.id === 'validation-1')).toBe(true);
    expect(validations.rows[0]?.controlCode).toBe('222222');
  });

  it('gives up after the domain limit of control-code draws', async () => {
    const { validatePayment, validations } = await harness({
      script: { payment: ok(found()) },
      digits: ['111111', '111111', '111111'],
    });
    validations.takenControlCodes.add('111111');

    await expect(validatePayment(INPUT)).rejects.toBeInstanceOf(AppError);
    expect(validations.inserts).toHaveLength(3);
    expect(validations.rows).toHaveLength(0);
  });

  it('copies is_sandbox from the connection onto the row', async () => {
    const { validatePayment, validations, points } = await harness({
      account: { environment: 'sandbox' },
      script: { payment: ok(found()) },
    });

    const result = await validatePayment(INPUT);

    expect(result.ok).toBe(true);
    expect(validations.rows[0]?.isSandbox).toBe(true);
    expect(points[0]).toMatchObject({ environment: 'sandbox' });
  });

  it('sends the bank exactly the four fields a pago móvil search takes', async () => {
    // The meeting on 2026-08-11: the bank was not receiving the payer's bank
    // code or phone. Every request carries all four or this fails.
    const { validatePayment, queries } = await harness({ script: { payment: ok(found()) } });

    await validatePayment(INPUT);

    expect(queries[0]).toEqual({
      kind: 'pago_movil',
      reference: '456789',
      payerPhone: '+584143125566',
      // A pago móvil never carries a receiving account, whatever the other tab
      // had on it — the kind's declaration is what decides.
      receivingAccount: null,
      sourceBankId: '0134',
      onDate: TODAY,
      sessionId: 'session-1',
    });
  });

  it('asks about the day the cashier says the customer paid, not about today', async () => {
    // A customer who paid last night and turns up this morning is findable only
    // because the date is a field.
    const { validatePayment, queries } = await harness({ script: { payment: ok(found()) } });

    await validatePayment({ ...INPUT, paymentDate: '2026-01-31' });

    expect(queries[0]?.onDate).toBe('2026-01-31');
  });

  it('trims a pasted whole reference to the tail the bank asks for', async () => {
    const { validatePayment, queries } = await harness({ script: { payment: ok(found()) } });

    await validatePayment({ ...INPUT, reference: '000123456789' });

    expect(queries[0]?.reference).toBe('456789');
  });

  it('takes the bank’s own digit count, not a hard-coded six', async () => {
    const { validatePayment, queries } = await harness({
      script: { payment: ok(found()), referenceDigits: 8 },
    });

    await validatePayment({ ...INPUT, reference: '0123456789' });

    expect(queries[0]?.reference).toBe('23456789');
  });

  it('refuses a reference shorter than the bank asks for, without calling it', async () => {
    const { validatePayment, calls } = await harness();

    expect(await validatePayment({ ...INPUT, reference: '4567' })).toEqual({
      ok: false,
      error: 'invalid_input',
    });
    expect(calls.authenticate).toBe(0);
  });

  /**
   * *Reintentar* is a question, not a replay.
   *
   * The counter's retry keeps the same idempotency key on purpose — a payment
   * that lands between two attempts must be charged once — and that key only
   * ever short-circuits a *stored* charge. An attempt the bank answered "todavía
   * no aparece" stores nothing, so the next one authenticates and asks again,
   * every time, however fast the previous answer came back.
   */
  it('asks the bank again on every retry of an unfound payment', async () => {
    const { validatePayment, calls } = await harness();

    const first = await validatePayment(INPUT);
    const second = await validatePayment(INPUT);
    const third = await validatePayment(INPUT);

    expect([first, second, third]).toEqual([
      { ok: true, value: { kind: 'not_found' } },
      { ok: true, value: { kind: 'not_found' } },
      { ok: true, value: { kind: 'not_found' } },
    ]);
    expect(calls).toEqual({ authenticate: 3, findPayment: 3 });
  });

  it('maps a bank in maintenance to a failure, and records the attempt', async () => {
    const { validatePayment, validations, points } = await harness({
      script: { payment: { ok: false, error: 'maintenance' } },
    });

    const result = await validatePayment(INPUT);

    expect(result).toEqual({ ok: false, error: 'maintenance' });
    expect(validations.inserts).toHaveLength(0);
    expect(points[0]).toMatchObject({
      outcome: 'bank_failure',
      bankStatus: 'maintenance',
      searchStrategy: 'none',
    });
  });

  it("folds the bank's own rate limit into 'unavailable'", async () => {
    const { validatePayment, points } = await harness({
      script: { authenticate: { ok: false, error: 'rate_limited' } },
    });

    const result = await validatePayment(INPUT);

    expect(result).toEqual({ ok: false, error: 'unavailable' });
    // The bank's word for it survives in the dataset even though the copy does
    // not: 'rate_limited' is where a throttled affiliation becomes visible.
    expect(points[0]).toMatchObject({ outcome: 'bank_failure', bankStatus: 'rate_limited' });
  });

  it('surfaces rejected credentials as themselves, not as unavailable', async () => {
    const { validatePayment } = await harness({
      script: { authenticate: { ok: false, error: 'rejected_credentials' } },
    });

    expect(await validatePayment(INPUT)).toEqual({ ok: false, error: 'rejected_credentials' });
  });

  it('requires a phone: every validation is a pago móvil', async () => {
    const { validatePayment, calls, points } = await harness();

    const result = await validatePayment({ ...INPUT, payerPhone: '   ' });

    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(calls.authenticate).toBe(0);
    expect(points).toEqual([]);
  });

  it('refuses a phone that is not a Venezuelan mobile before asking the bank', async () => {
    const { validatePayment, calls, points } = await harness();

    const result = await validatePayment({ ...INPUT, payerPhone: '0212-5551234' });

    expect(result).toEqual({ ok: false, error: 'invalid_input' });
    expect(calls.authenticate).toBe(0);
    expect(points).toEqual([]);
  });

  it('refuses a Sudeban code that is not a bank', async () => {
    const { validatePayment, calls } = await harness();

    expect(await validatePayment({ ...INPUT, sourceBankId: '134' })).toEqual({
      ok: false,
      error: 'invalid_input',
    });
    expect(calls.findPayment).toBe(0);
  });

  it('refuses an amount that is not a positive count of cents', async () => {
    const { validatePayment } = await harness();

    expect(await validatePayment({ ...INPUT, amountCents: 0 })).toMatchObject({
      ok: false,
      error: 'invalid_input',
    });
    expect(await validatePayment({ ...INPUT, amountCents: 1240.5 })).toMatchObject({
      ok: false,
      error: 'invalid_input',
    });
  });

  it.each([['not-a-date'], ['2026-2-1'], ['2026-02-02']])(
    'refuses the payment date %s before asking the bank',
    async (paymentDate) => {
      // The last one is tomorrow: a payment cannot have happened yet.
      const { validatePayment, calls } = await harness();

      expect(await validatePayment({ ...INPUT, paymentDate })).toEqual({
        ok: false,
        error: 'invalid_input',
      });
      expect(calls.authenticate).toBe(0);
    },
  );

  it('answers no_bank_account without a metric, because no bank was involved', async () => {
    const { validatePayment, points, calls } = await harness({ account: null });

    expect(await validatePayment(INPUT)).toEqual({ ok: false, error: 'no_bank_account' });
    expect(calls.authenticate).toBe(0);
    expect(points).toEqual([]);
  });

  it('treats a chosen connection that is not this company’s as no connection', async () => {
    // Scoped by company first and only then narrowed to the id, so a tampered
    // value finds nothing rather than another merchant's row.
    const { validatePayment, calls } = await harness();

    expect(await validatePayment({ ...INPUT, bankAccountId: 'account-elsewhere' })).toEqual({
      ok: false,
      error: 'no_bank_account',
    });
    expect(calls.authenticate).toBe(0);
  });

  it('records the latency the cashier waited, on the row and on the metric', async () => {
    const { validatePayment, validations, points } = await harness({
      script: { payment: ok(found()) },
      clock: steppingClock(NOW, 100),
    });

    await validatePayment(INPUT);

    expect(validations.rows[0]?.latencyMs).toBeGreaterThan(0);
    expect(points[0]?.latencyMs).toBeGreaterThan(0);
  });

  /**
   * The bug this replaced: a pago móvil from Banco de Venezuela was recorded,
   * and re-opened, as "Banco emisor · Banesco". Banesco's `sourceBankId` names
   * the bank whose books the movement sits in — itself — and we were preferring
   * it over the code the cashier picked. The picked code is the one the search
   * matched on, so a movement coming back at all is the bank confirming it.
   */
  it("records the bank the payment was found with, not the one on the bank's row", async () => {
    const { validatePayment, validations } = await harness({
      script: { payment: ok(found({ sourceBankId: '0134' })) },
    });

    await validatePayment({ ...INPUT, sourceBankId: '0102' });

    expect(validations.rows[0]?.sourceBankId).toBe('0102');
  });
});
