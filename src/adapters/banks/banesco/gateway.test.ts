import { afterEach, describe, expect, it, vi } from 'vitest';

import type { BankGatewayDeps, BankSession } from '../../../application/ports/bank-gateway.ts';
import { BanescoGateway } from './gateway.ts';

// Two fields only: the client is its own resource owner in the password
// grant, so id + secret are all four values the grant needs.
const CREDENTIALS = {
  clientId: 'cuadre-qa-client',
  clientSecret: 'super-secret-value',
};

const QUERY = {
  accountId: '01340123450123458514',
  reference: '000123456789',
  payerPhone: '584143125566',
  sourceBankId: '0134',
  onDate: '2026-08-06',
  sessionId: 'cashier-session-1',
};

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

/** Consulta de Cuentas V2.0 §V.b — `dataResponse` is the account array itself. */
const accountsReply = (statusCode: string, dataResponse: unknown = null) => ({
  httpStatus: { statusCode, statusDesc: 'OK' },
  dataResponse,
});

type Sent = { url: string; body: string };

/** Routes by URL: one stub stands in for the whole bank. */
function stubBank(payments: unknown[], products: unknown = accountsReply('204')): Sent[] {
  const queue = [...payments];
  const sent: Sent[] = [];

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: String(init.body) });

    if (url.includes('/token')) return new Response(JSON.stringify(TOKEN), { status: 200 });
    if (url.includes('/customer/products')) {
      return new Response(JSON.stringify(products), { status: 200 });
    }
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
  return { tokens: fakeTokens(), egressIp: '200.11.22.33', userAgent: 'cuadre/1.0' };
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

    expect(await gateway.listAccounts(forged)).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('findPayment', () => {
  it('finds it by the whole reference and says so', async () => {
    const sent = stubBank([rows(detail())]);
    const { gateway, session } = await authenticated();

    const found = await gateway.findPayment(session, QUERY);

    expect(paymentCalls(sent)).toHaveLength(1);
    expect(found).toMatchObject({
      ok: true,
      value: {
        strategy: 'exact_reference',
        movement: { reference: '000123456789', amountCents: 124_000, isCredit: true },
      },
    });
  });

  it('falls back to the tail search when the reference is not settled yet', async () => {
    const sent = stubBank([NO_RESULTS, rows(detail())]);
    const { gateway, session } = await authenticated();

    const found = await gateway.findPayment(session, QUERY);

    expect(paymentCalls(sent)).toHaveLength(2);
    expect(paymentCalls(sent)[1].body).toContain('"phoneNum":"584143125566"');
    expect(found).toMatchObject({ ok: true, value: { strategy: 'reference_tail_and_phone' } });
  });

  it('answers "not yet" rather than an error when neither route finds it', async () => {
    stubBank([NO_RESULTS, NO_RESULTS]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toEqual({ ok: true, value: null });
  });

  it('stops at the first real failure instead of falling back', async () => {
    const sent = stubBank([confirmationReply('VRN04')]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toEqual({ ok: false, error: 'maintenance' });
    expect(paymentCalls(sent)).toHaveLength(1);
  });

  it('never takes a debit for a payment received', async () => {
    stubBank([rows(detail({ trnType: 'DB' })), rows(detail({ trnType: 'DB' }))]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toEqual({ ok: true, value: null });
  });

  it('ignores a credit that landed on somebody else’s account', async () => {
    // The tail search is asked without an account, so the account is what has
    // to be checked on the way back.
    const other = detail({ accountId: '1340************9999' });
    stubBank([rows(other), rows(other)]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toEqual({ ok: true, value: null });
  });

  it('ignores a credit with a different reference', async () => {
    const other = detail({ referenceNumber: '000987654321' });
    stubBank([rows(other), rows(other)]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toEqual({ ok: true, value: null });
  });

  it('accepts the reference the bank returns without its leading zeros', async () => {
    stubBank([rows(detail({ referenceNumber: '123456789' }))]);
    const { gateway, session } = await authenticated();

    expect(await gateway.findPayment(session, QUERY)).toMatchObject({
      ok: true,
      value: { strategy: 'exact_reference' },
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

describe('listAccounts', () => {
  it('maps the bank’s products', async () => {
    stubBank([], accountsReply('200', [{ accountId: '0134************8514', accountType: 'DDA' }]));
    const { gateway, session } = await authenticated();

    expect(await gateway.listAccounts(session)).toMatchObject({
      ok: true,
      // Masked at the source: this service never returns a full number.
      value: [{ accountId: '0134************8514', masked: '0134************8514' }],
    });
  });
});

describe('listMovements', () => {
  it('returns the day’s credits and debits alike', async () => {
    stubBank([rows(detail(), detail({ trnType: 'DB', referenceNumber: '999' }))]);
    const { gateway, session } = await authenticated();

    const listed = await gateway.listMovements(session, {
      accountId: QUERY.accountId,
      from: '2026-08-06',
      to: '2026-08-06',
    });

    expect(listed).toMatchObject({ ok: true });
    expect(listed.ok && listed.value).toHaveLength(2);
  });

  it('reports an empty day as an empty list, not as an error', async () => {
    stubBank([NO_RESULTS]);
    const { gateway, session } = await authenticated();

    const listed = await gateway.listMovements(session, {
      accountId: QUERY.accountId,
      from: '2026-08-06',
      to: '2026-08-06',
    });

    expect(listed).toEqual({ ok: true, value: [] });
  });
});
