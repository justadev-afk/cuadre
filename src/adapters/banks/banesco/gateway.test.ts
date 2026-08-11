import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BankGatewayDeps, BankSession } from '../../../application/ports/bank-gateway.ts';
import { BanescoGateway } from './gateway.ts';

// Two fields only: the client is its own resource owner in the password
// grant, so id + secret are all four values the grant needs.
const CREDENTIALS = {
  clientId: 'cuadre-qa-client',
  clientSecret: 'super-secret-value',
};

/** What the counter asks with: the reference *tail*, never the whole number. */
const QUERY = {
  kind: 'pago_movil',
  reference: '456789',
  payerPhone: '584143125566',
  receivingAccount: null,
  sourceBankId: '0134',
  onDate: '2026-08-06',
  sessionId: 'cashier-session-1',
} as const;

/** The transferencia claim: an account instead of a phone, and no date at all. */
const TRANSFER_QUERY = {
  kind: 'transferencia',
  reference: '150496',
  payerPhone: null,
  receivingAccount: '01340804108041005394',
  sourceBankId: '0134',
  onDate: null,
  sessionId: 'cashier-session-1',
} as const;

function detail(overrides: Record<string, unknown> = {}) {
  return {
    referenceNumber: '000123456789',
    amount: '1240.00',
    currencyCode: 'BS ',
    accountId: '1340************8514',
    trnDate: '2026-08-06',
    trnTime: '10:30:00',
    trnType: 'CR',
    sourceBankId: '0134',
    concept: 'Pago Movil',
    customerIdBen: 'J-12345678-9',
    ...overrides,
  };
}

const TOKEN = { access_token: 'header.payload.signature', expires_in: 300 };
/**
 * Confirmación de Transacciones V1.3 §V.b: the status lives inside
 * `httpStatus` and the rows inside `dataResponse.transactionDetail`. A miss
 * arrives as the same shape with `dataResponse: null`.
 */
const confirmationReply = (statusCode: string, details?: Array<Record<string, unknown>>) => ({
  httpStatus: { statusCode, statusDesc: statusCode === '200' ? 'OK' : statusCode },
  dataResponse: details ? { transactionDetail: details } : null,
});

const NO_RESULTS = confirmationReply('70001');
const rows = (...details: Array<Record<string, unknown>>) => confirmationReply('200', details);

type Sent = { url: string; body: string };

/** Routes by URL: one stub stands in for the whole bank. */
function stubBank(payments: unknown[]): Sent[] {
  const queue = [...payments];
  const sent: Sent[] = [];

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body) });

    if (url.includes('/token')) return new Response(JSON.stringify(TOKEN), { status: 200 });
    return new Response(JSON.stringify(queue.shift() ?? NO_RESULTS), { status: 200 });
  });

  return sent;
}

function fakeTokens(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
  } as unknown as KVNamespace;
}

function deps(): BankGatewayDeps {
  return {
    tokens: fakeTokens(),
    egressIp: '200.11.22.33',
    userAgent: 'cuadre/1.0',
    debug: false,
  };
}

async function authenticated() {
  const gateway = new BanescoGateway(deps());
  const session = await gateway.authenticate('sandbox', CREDENTIALS);
  if (!session.ok) throw new Error(`authenticate failed: ${session.error}`);
  return { gateway, session: session.value };
}

const paymentCalls = (sent: Sent[]) =>
  sent.filter((call) => call.url.endsWith('/transactions/financial-account/transactions'));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BanescoGateway', () => {
  it('is the registry entry the bank_accounts row points at', () => {
    const gateway = new BanescoGateway(deps());

    expect(gateway.id).toBe('banesco');
    expect(gateway.displayName).toBe('Banesco');
    expect(gateway.environments).toEqual(['production', 'sandbox']);
  });

  it('asks for both pairs, and names what each one is for', () => {
    // Confirmación is required and is what the counter validates with; Consulta
    // is optional and only lists accounts. A merchant given a single client for
    // everything leaves the second blank — `discoverCredential` falls back.
    const gateway = new BanescoGateway(deps());

    // One pair. Consulta de Saldo is deliberately not asked for: it answers
    // with masked account numbers the payment search then refuses with a 400.
    expect(gateway.credentialGroups.map((group) => group.key)).toEqual(['confirmation']);
    expect(gateway.credentialGroups.map((group) => group.required)).toEqual([true]);
    expect(gateway.operateKey).toBe('confirmation');
  });

  it('offers both kinds, each with what it actually takes', () => {
    const kinds = new BanescoGateway(deps()).paymentKinds;

    expect(kinds.map((kind) => kind.kind)).toEqual(['pago_movil', 'transferencia']);
    // Six for a pago móvil; the whole reference for a transferencia, which is
    // what the customer's receipt carries.
    expect(kinds.map((kind) => kind.referenceDigits)).toEqual([6, null]);
    // The asymmetry is the point, and it is what QA answers to: a pago móvil
    // needs a phone and a date, a transferencia an account and no date.
    expect(kinds[0]).toMatchObject({
      needsPayerPhone: true,
      needsReceivingAccount: false,
      needsDate: true,
    });
    expect(kinds[1]).toMatchObject({
      needsPayerPhone: false,
      needsReceivingAccount: true,
      needsDate: false,
    });
  });
});

describe('authenticate', () => {
  it('opens a session with a correlation id that is not a secret', async () => {
    stubBank([]);

    const { session } = await authenticated();

    expect(session.bank).toBe('banesco');
    expect(session.environment).toBe('sandbox');
    expect(session.correlationId).not.toContain(CREDENTIALS.clientSecret);
    expect(session.correlationId.length).toBeGreaterThan(8);
  });

  it('reports the bank’s rejection', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 }),
    );
    const gateway = new BanescoGateway(deps());

    expect(await gateway.authenticate('sandbox', CREDENTIALS)).toEqual({
      ok: false,
      error: 'rejected_credentials',
    });
  });

  it('refuses to work with a session it did not open', async () => {
    stubBank([]);
    const { gateway } = await authenticated();
    const forged: BankSession = {
      bank: 'banesco',
      environment: 'sandbox',
      correlationId: 'not-ours',
    };

    expect(await gateway.findPayment(forged, QUERY)).toEqual({ ok: false, error: 'unavailable' });
  });

  it('fails cleanly for production instead of throwing, since its hosts are unpublished', async () => {
    // `banescoEndpoints('production')` throws by design; authenticate must catch
    // that upstream and return a failure, or onboarding 500s instead of showing
    // a toast. No network call is made — the guard is hit before the token round
    // trip — so any fetch here would be a bug.
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const gateway = new BanescoGateway(deps());

    expect(await gateway.authenticate('production', CREDENTIALS)).toEqual({
      ok: false,
      error: 'unavailable',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('findPayment · transferencia', () => {
  it('asks by the whole reference and the receiving account, and sends NO date', async () => {
    // The omission is load-bearing: sending `startDt` turns a movement the bank
    // had just returned into `70001 · sin resultados`, verified against QA on
    // the transferencia's own reported date.
    const sent = stubBank([rows(detail({ referenceNumber: '150496', concept: 'TRANS.CTAS' }))]);
    const { gateway, session } = await authenticated();

    const found = await gateway.findPayment(session, {
      ...TRANSFER_QUERY,
      reference: '00000150496',
    });

    expect(paymentCalls(sent)).toHaveLength(1);
    const body = paymentCalls(sent)[0].body;
    // Whole, not trimmed to a tail — and the bank answers with its own unpadded
    // spelling regardless, which `sameReference` folds.
    expect(body).toContain('"referenceNumber":"00000150496"');
    expect(body).toContain('"accountId":"01340804108041005394"');
    expect(body).not.toContain('startDt');
    expect(body).not.toContain('phoneNum');
    expect(found).toMatchObject({
      ok: true,
      value: { strategy: 'reference_tail_and_account', movement: { reference: '150496' } },
    });
  });

  it('answers "not yet" rather than an error when the bank has nothing', async () => {
    stubBank([NO_RESULTS]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, TRANSFER_QUERY)).toEqual({ ok: true, value: null });
  });
});

describe('findPayment', () => {
  it('asks once, carrying the phone, the payer’s bank and the date', async () => {
    // The bank's complaint on 2026-08-11 was that it was not receiving the bank
    // code or the phone, because the old flow tried an exact-reference search
    // first and only fell back to the shape that carries them. There is one
    // call now and it always carries all four.
    const sent = stubBank([rows(detail())]);
    const { gateway, session } = await authenticated();

    const found = await gateway.findPayment(session, QUERY);

    expect(paymentCalls(sent)).toHaveLength(1);
    expect(paymentCalls(sent)[0].body).toContain('"phoneNum":"584143125566"');
    expect(paymentCalls(sent)[0].body).toContain('"bankId":"0134"');
    expect(paymentCalls(sent)[0].body).toContain('"startDt":"2026-08-06"');
    expect(found).toMatchObject({
      ok: true,
      value: {
        strategy: 'reference_tail_and_phone',
        movement: { reference: '000123456789', amountCents: 124_000, isCredit: true },
      },
    });
  });

  it('answers "not yet" rather than an error when the bank has nothing', async () => {
    stubBank([NO_RESULTS]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toEqual({ ok: true, value: null });
  });

  it('reports a real failure as a failure', async () => {
    const sent = stubBank([confirmationReply('VRN04')]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toEqual({ ok: false, error: 'maintenance' });
    expect(paymentCalls(sent)).toHaveLength(1);
  });

  it('never takes a debit for a payment received', async () => {
    stubBank([rows(detail({ trnType: 'DB' }))]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toEqual({ ok: true, value: null });
  });

  it('matches the merchant’s payment whatever account it settled on', async () => {
    // The Confirmación search is scoped to the merchant by its credentials, so a
    // credit it returns for this reference is theirs whichever of their accounts
    // it landed on — a pago móvil settles on whatever account its receiving
    // phone maps to. The account is not a filter, and the request never carried
    // one even before it stopped being stored.
    stubBank([rows(detail({ accountId: '1340************9999' }))]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toMatchObject({
      ok: true,
      value: { strategy: 'reference_tail_and_phone', movement: { isCredit: true } },
    });
  });

  it('ignores a credit with a different reference', async () => {
    stubBank([rows(detail({ referenceNumber: '000987654321' }))]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toEqual({ ok: true, value: null });
  });

  it('accepts the tail echoed back as the whole reference the bank knows', async () => {
    // We ask with six digits; the bank normally answers with the full number.
    // `sameReference` folds the two, which is what lets the row record the
    // bank's spelling rather than the cashier's.
    stubBank([rows(detail({ referenceNumber: '123456789' }))]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toMatchObject({
      ok: true,
      value: { movement: { reference: '123456789' } },
    });
  });

  it('accepts the bare six digits when that is all the bank returns', async () => {
    stubBank([rows(detail({ referenceNumber: '456789' }))]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toMatchObject({
      ok: true,
      value: { movement: { reference: '456789' } },
    });
  });

  it('takes the most recent when the bank reports the same payment twice', async () => {
    const older = detail({ trnTime: '09:00:00' });
    stubBank([rows(older, detail())]);
    const { gateway, session } = await authenticated();

    const found = await gateway.findPayment(session, QUERY);

    expect(found).toMatchObject({
      ok: true,
      value: { movement: { occurredAt: Date.parse('2026-08-06T14:30:00Z') / 1000 } },
    });
  });
});

/**
 * The live QA pago móvil, pinned **exactly as the bank sends it**.
 *
 * This is the row copied out of a real QA reply on 2026-08-11 (ref 12346090431 →
 * CR Bs 630, the bank's own certification test data), and every oddity in it is
 * deliberate, because each one broke us once:
 *
 *   trnTime "00.00.00"   dots, not the colons the manual documents. The parser
 *                        refused it, which failed the whole reply, which the
 *                        counter read out as "el banco no pudo responder" for a
 *                        payment the bank had just handed over.
 *   currencyCode "Bs"    mixed case, no padding — the manual says 'BS '.
 *   referenceNumber      only the **six digits we asked with**, not the twelve
 *                        the merchant's receipt shows. This is what makes
 *                        `paymentKey` fold the date in.
 *   sourceBankId "134"   unpadded; the Sudeban code is four digits.
 *   customerIdBen        padded with trailing spaces.
 *
 * Replayed from the recording, never against the live bank (§12).
 */
describe('regression: the QA pago móvil as the bank actually sends it', () => {
  const QaDetail = {
    referenceNumber: '090431',
    amount: 630,
    currencyCode: 'Bs',
    exchangeRate: 0,
    accountId: '5841************5031',
    trnDate: '2026-07-10',
    trnTime: '00.00.00',
    sourceBankId: '134',
    destBankId: '134',
    concept: 'Banesco Pago Movil                 ',
    customerIdBen: 'J003075523     ',
    trnType: 'CR',
  };
  const QaQuery = { ...QUERY, reference: '090431', onDate: '2026-07-10' };

  it('validates it: Bs 630 as 63 000 cents, a credit', async () => {
    const sent = stubBank([rows(QaDetail)]);
    const { gateway, session } = await authenticated();

    const found = await gateway.findPayment(session, QaQuery);

    expect(paymentCalls(sent)).toHaveLength(1);
    expect(found).toMatchObject({
      ok: true,
      value: {
        strategy: 'reference_tail_and_phone',
        movement: {
          reference: '090431',
          amountCents: 63_000,
          currency: 'BS',
          sourceBankId: '0134',
          isCredit: true,
        },
      },
    });
  });

  it('dates it at the local midnight the bank reported, not at the epoch', async () => {
    stubBank([rows(QaDetail)]);
    const { gateway, session } = await authenticated();

    const found = await gateway.findPayment(session, QaQuery);

    expect(found.ok && found.value?.movement.occurredAt).toBe(
      Date.parse('2026-07-10T04:00:00Z') / 1000,
    );
  });
});
