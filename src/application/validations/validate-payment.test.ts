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
const CREDS_KEY = 'a-test-master-key-of-at-least-32-bytes';
const COMPANY = 'la-espiga';
const ACCOUNT_NUMBER = '01340123450123458514';

const CREDENTIALS = {
  clientId: 'cuadre-qa-client',
  clientSecret: 'super-secret-value',
  username: 'cuadre-qa-user',
  password: 'super-secret-password',
};

const SESSION: BankSession = {
  bank: 'banesco',
  environment: 'production',
  correlationId: 'correlation-1',
};

/** The counter's claim. The reference is typed without the bank's padding. */
const INPUT: ValidatePaymentInput = {
  companyId: COMPANY,
  cashierId: 'user-maria',
  sessionId: 'session-1',
  reference: '123456789',
  payerPhone: '0414-3125566',
  sourceBankId: '0134',
  amountCents: 124_000,
  idempotencyKey: 'idem-1',
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
  strategy: 'exact_reference',
});

async function bankAccount(overrides: Partial<BankAccount> = {}): Promise<BankAccount> {
  return {
    id: 'account-1',
    companyId: COMPANY,
    bank: 'banesco',
    environment: 'production',
    credentials: await seal(CREDS_KEY, { main: CREDENTIALS }),
    clientIdLast6: 'client',
    accountNumber: await seal(CREDS_KEY, ACCOUNT_NUMBER),
    accountLast4: '8514',
    accountType: 'Corriente',
    holderId: 'J-12345678-9',
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
    isSandbox: false,
    controlCode: '111111',
    reference: '000123456789',
    amountCents: 124_000,
    currency: 'BS',
    payerPhone: '584143125566',
    sourceBankId: '0134',
    trnAt: NOW - 300,
    latencyMs: 420,
    searchMode: 'exact_reference',
    idempotencyKey: 'idem-1',
    createdAt: NOW - 60,
    ...overrides,
  };
}

/**
 * The three unique indexes, in memory. A fake that did not enforce them would
 * pass every test in this file while the real table refused the same rows.
 */
function fakeValidations(seed: readonly Validation[] = []) {
  const rows: Validation[] = [...seed];
  const takenControlCodes = new Set<string>();
  const inserts: NewValidation[] = [];

  return {
    rows,
    inserts,
    takenControlCodes,

    async findByIdempotencyKey(key: string): Promise<Validation | null> {
      return rows.find((row) => row.idempotencyKey === key) ?? null;
    },

    async findChargedPayment(
      bankAccountIds: readonly string[],
      reference: string,
    ): Promise<Validation | null> {
      return (
        rows.find(
          (row) => row.reference === reference && bankAccountIds.includes(row.bankAccountId),
        ) ?? null
      );
    },

    async insert(input: NewValidation): Promise<InsertResult> {
      inserts.push(input);

      if (rows.some((row) => row.idempotencyKey === input.idempotencyKey)) {
        return { outcome: 'idempotent_replay' };
      }
      if (
        rows.some(
          (row) => row.bankAccountId === input.bankAccountId && row.reference === input.reference,
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

type GatewayScript = {
  authenticate?: Result<BankSession, BankFailure>;
  payment?: Result<FoundPayment | null, BankFailure>;
};

function fakeBanks(script: GatewayScript = {}) {
  const calls = { authenticate: 0, findPayment: 0 };
  const queries: FindPaymentQuery[] = [];

  const gateway: BankGateway = {
    id: 'banesco',
    displayName: 'Banesco',
    environments: ['production', 'sandbox'],
    credentialGroups: [
      { key: 'main', usage: 'operate', label: 'Principal', required: true, fields: [] },
    ],

    async authenticate() {
      calls.authenticate++;
      return script.authenticate ?? ok(SESSION);
    },
    async listAccounts() {
      return ok([]);
    },
    async findPayment(_session, query) {
      calls.findPayment++;
      queries.push(query);
      return script.payment ?? ok(null);
    },
    async listMovements() {
      return ok([]);
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
    digits?: string[];
    clock?: Clock;
  } = {},
) {
  const account = options.account === null ? null : await bankAccount(options.account ?? {});
  const validations = fakeValidations(options.seed);
  const { banks, calls, queries } = fakeBanks(options.script);
  const { metrics, points } = fakeMetrics();

  const validatePayment = makeValidatePayment({
    accounts: {
      async listActiveForCompany(companyId, environment) {
        if (account === null || companyId !== account.companyId) return [];
        return account.environment === environment ? [account] : [];
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
      searchMode: 'exact_reference',
      // Normalised by the domain on the way in, whatever the customer read out.
      payerPhone: '584143125566',
      createdAt: NOW,
    });
    expect(points).toEqual([
      {
        companyId: COMPANY,
        bank: 'banesco',
        environment: 'production',
        searchStrategy: 'exact_reference',
        outcome: 'confirmed',
        bankStatus: null,
        latencyMs: 0,
        amountCents: 124_000,
      },
    ]);
  });

  it("stores the bank's reference, not the one that was typed", async () => {
    // Typed '123456789', the bank pads to '000123456789'. `matchPayment` folds
    // the leading zeros, so both spell one payment — and only one of them can
    // be stored, or `ux_validations_payment` stops preventing a double charge.
    const { validatePayment, validations } = await harness({ script: { payment: ok(found()) } });

    await validatePayment(INPUT);

    expect(validations.rows[0]?.reference).toBe('000123456789');
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
      searchStrategy: 'exact_reference',
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

  it('answers already-charged before the bank when the typed reference matches', async () => {
    const { validatePayment, validations, points } = await harness({
      // Stored with the same unpadded reference the cashier types, so the
      // pre-flight check finds it and no bank is ever asked.
      seed: [
        storedValidation({
          idempotencyKey: 'idem-0',
          controlCode: '999999',
          reference: '123456789',
          cashierName: 'María Rodríguez',
          createdAt: NOW - 120,
        }),
      ],
      script: { payment: ok(found()) },
    });

    const result = await validatePayment(INPUT);

    expect(result).toEqual({
      ok: true,
      value: { kind: 'already_charged', by: 'María Rodríguez', at: NOW - 120 },
    });
    // The pre-check short-circuited: nothing was inserted (had it fallen through
    // to the bank, the unpadded seed would not have matched the insert and a
    // second row would exist).
    expect(validations.inserts).toHaveLength(0);
    expect(validations.rows).toHaveLength(1);
    expect(points[0]).toMatchObject({ outcome: 'already_charged', amountCents: 124_000 });
  });

  it('names who charged a payment the bank padded past the pre-check, at the insert', async () => {
    const { validatePayment, validations, points } = await harness({
      // The stored reference carries the bank's padding, so the typed reference
      // misses the pre-check and the unique index catches it at the insert —
      // which still reads back who charged it.
      seed: [
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

  it('copies is_sandbox from the account onto the row', async () => {
    const { validatePayment, validations, points } = await harness({
      account: { environment: 'sandbox' },
      script: { payment: ok(found()) },
    });

    const result = await validatePayment({ ...INPUT, environment: 'sandbox' });

    expect(result.ok).toBe(true);
    expect(validations.rows[0]?.isSandbox).toBe(true);
    expect(points[0]).toMatchObject({ environment: 'sandbox' });
  });

  it('reads production by default and never the sandbox account', async () => {
    const { validatePayment, validations } = await harness({
      account: { environment: 'sandbox' },
      script: { payment: ok(found()) },
    });

    // The company holds only a sandbox account; the counter asked for none, so
    // it asked for production and there is nothing to answer with.
    const result = await validatePayment(INPUT);

    expect(result).toEqual({ ok: false, error: 'no_bank_account' });
    expect(validations.inserts).toHaveLength(0);
  });

  it('unseals the account number and sends it to the bank, never the masked one', async () => {
    const { validatePayment, queries } = await harness({ script: { payment: ok(found()) } });

    await validatePayment(INPUT);

    expect(queries[0]).toEqual({
      accountId: ACCOUNT_NUMBER,
      reference: '123456789',
      payerPhone: '584143125566',
      sourceBankId: '0134',
      onDate: '2026-02-01',
      sessionId: 'session-1',
    });
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

  it('answers no_bank_account without a metric, because no bank was involved', async () => {
    const { validatePayment, points, calls } = await harness({ account: null });

    expect(await validatePayment(INPUT)).toEqual({ ok: false, error: 'no_bank_account' });
    expect(calls.authenticate).toBe(0);
    expect(points).toEqual([]);
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

  it("prefers the bank's paying bank over the one the customer picked", async () => {
    const { validatePayment, validations } = await harness({
      script: { payment: ok(found({ sourceBankId: '0172' })) },
    });

    await validatePayment(INPUT);

    expect(validations.rows[0]?.sourceBankId).toBe('0172');
  });
});

/**
 * A company can have more than one receiving account for an environment. The
 * counter asks each in turn — a payment lands in exactly one — and an explicit
 * `accountId` scopes to just that one. These build the use case directly so the
 * accounts reader can return two accounts with different numbers.
 */
describe('validate payment across accounts', () => {
  const AccA = '01340000000000000001';
  const AccB = '01340000000000000002';

  async function twoAccounts(): Promise<readonly BankAccount[]> {
    return [
      await bankAccount({ id: 'account-a', accountNumber: await seal(CREDS_KEY, AccA) }),
      await bankAccount({ id: 'account-b', accountNumber: await seal(CREDS_KEY, AccB) }),
    ];
  }

  /** A gateway that reports the movement only on the account holding `paidTo`. */
  function gatewayReporting(paidTo: string) {
    const asked: string[] = [];
    const gateway: BankGateway = {
      id: 'banesco',
      displayName: 'Banesco',
      environments: ['production', 'sandbox'],
      credentialGroups: [
        { key: 'main', usage: 'operate', label: 'Principal', required: true, fields: [] },
      ],
      async authenticate() {
        return ok(SESSION);
      },
      async listAccounts() {
        return ok([]);
      },
      async findPayment(_session, query) {
        asked.push(query.accountId);
        return query.accountId === paidTo ? ok(found()) : ok(null);
      },
      async listMovements() {
        return ok([]);
      },
    };
    return { banks: { get: () => gateway }, asked };
  }

  function build(
    list: readonly BankAccount[],
    banks: { get: () => BankGateway },
    validations: ReturnType<typeof fakeValidations>,
    metrics: ReturnType<typeof fakeMetrics>['metrics'],
  ) {
    return makeValidatePayment({
      accounts: {
        async listActiveForCompany() {
          return list;
        },
      },
      validations,
      banks,
      metrics,
      clock: fixedClock(NOW),
      ids: fakeIdGen({ uuids: ['validation-1'], digits: ['654321'] }),
      credsKey: CREDS_KEY,
    });
  }

  it('walks to the account that reports the movement and confirms there', async () => {
    const { banks, asked } = gatewayReporting(AccB);
    const validations = fakeValidations();
    const { metrics, points } = fakeMetrics();
    const validate = build(await twoAccounts(), banks, validations, metrics);

    const result = await validate(INPUT);

    expect(result).toMatchObject({ ok: true, value: { kind: 'confirmed' } });
    // Asked A first (null), then B (the movement): two round trips, in order.
    expect(asked).toEqual([AccA, AccB]);
    expect(validations.rows[0]?.bankAccountId).toBe('account-b');
    // One metric for the attempt, attributed to the account that answered.
    expect(points).toHaveLength(1);
    expect(points[0]?.outcome).toBe('confirmed');
  });

  it('stops at the first account that has the payment', async () => {
    const { banks, asked } = gatewayReporting(AccA);
    const validations = fakeValidations();
    const { metrics } = fakeMetrics();
    const validate = build(await twoAccounts(), banks, validations, metrics);

    await validate(INPUT);

    // A has it, so B is never asked — no wasted round trip at the counter.
    expect(asked).toEqual([AccA]);
    expect(validations.rows[0]?.bankAccountId).toBe('account-a');
  });

  it('scopes to the chosen account when accountId is given', async () => {
    const { banks, asked } = gatewayReporting(AccB);
    const validations = fakeValidations();
    const { metrics } = fakeMetrics();
    const validate = build(await twoAccounts(), banks, validations, metrics);

    const result = await validate({ ...INPUT, accountId: 'account-b' });

    expect(result).toMatchObject({ ok: true, value: { kind: 'confirmed' } });
    // Only B was asked — A was out of scope.
    expect(asked).toEqual([AccB]);
  });

  it('is not_found when no account reports it, and asks them all', async () => {
    const { banks, asked } = gatewayReporting('nobody');
    const validations = fakeValidations();
    const { metrics, points } = fakeMetrics();
    const validate = build(await twoAccounts(), banks, validations, metrics);

    const result = await validate(INPUT);

    expect(result).toMatchObject({ ok: true, value: { kind: 'not_found' } });
    expect(asked).toEqual([AccA, AccB]);
    expect(points).toHaveLength(1);
    expect(points[0]?.outcome).toBe('not_found');
  });

  it('treats a stale chosen accountId as no account', async () => {
    const { banks, asked } = gatewayReporting(AccA);
    const validations = fakeValidations();
    const { metrics } = fakeMetrics();
    const validate = build(await twoAccounts(), banks, validations, metrics);

    const result = await validate({ ...INPUT, accountId: 'account-removed' });

    expect(result).toEqual({ ok: false, error: 'no_bank_account' });
    expect(asked).toEqual([]);
  });
});
