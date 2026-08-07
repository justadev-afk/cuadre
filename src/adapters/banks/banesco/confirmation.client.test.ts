import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BanescoConfirmationCall, BanescoConfirmationClient } from './confirmation.client.ts';
import { serverDevice } from './envelope.ts';

const CLIENT = new BanescoConfirmationClient(serverDevice('200.11.22.33'), 'cuadre/1.0');

const CALL: BanescoConfirmationCall = {
  environment: 'sandbox',
  accessToken: 'header.payload.signature',
  sessionId: 'cashier-session-1',
};

/** One row as the bank sends it: padded currency, decimal amount, local time. */
const DETAIL = {
  referenceNumber: '000123456789',
  amount: '1240.00',
  currencyCode: 'BS ',
  accountId: '1340************8514',
  trnDate: '2026-08-06',
  trnTime: '10:30:00',
  trnType: 'CR',
  sourceBankId: '134',
  destBankId: '0134',
  concept: '  Pago Movil ',
  customerIdBen: 'J-12345678-9',
};

const MOVEMENT = {
  reference: '000123456789',
  amountCents: 124_000,
  currency: 'BS',
  accountMasked: '1340************8514',
  occurredAt: Date.parse('2026-08-06T14:30:00Z') / 1000,
  sourceBankId: '0134',
  concept: 'Pago Movil',
  beneficiaryId: 'J-12345678-9',
  isCredit: true,
};

type Reply = { status: number; body: unknown };

/**
 * Confirmación de Transacciones V1.3 §V.b: the status lives inside
 * `httpStatus` and the rows inside `dataResponse.transactionDetail`. A miss
 * arrives as the same shape with `dataResponse: null`.
 */
const confirmationReply = (statusCode: string, details?: Array<Record<string, unknown>>) => ({
  httpStatus: { statusCode, statusDesc: statusCode === '200' ? 'OK' : statusCode },
  dataResponse: details ? { transactionDetail: details } : null,
});

const found: Reply = { status: 200, body: confirmationReply('200', [DETAIL]) };
const empty: Reply = { status: 200, body: confirmationReply('70001') };
const tooWide: Reply = { status: 200, body: confirmationReply('70005') };

type Sent = { url: string; body: Record<string, unknown> };

function stubBank(replies: Reply[]): Sent[] {
  const queue = [...replies];
  const sent: Sent[] = [];

  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    const reply = queue.shift() ?? empty;
    return new Response(JSON.stringify(reply.body), { status: reply.status });
  });

  return sent;
}

/** The bank's envelope, as it arrives on the wire. */
function transactionOf(sent: Sent): Record<string, unknown> {
  const request = sent.body.dataRequest as Record<string, unknown>;
  return request.transaction as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BanescoConfirmationClient.findByExactReference', () => {
  it('asks for the whole reference, inside the bank’s envelope', async () => {
    const sent = stubBank([found]);

    await CLIENT.findByExactReference(CALL, ' 000123456789 ');

    expect(sent[0].url).toContain('/transactions/financial-account/transactions');
    expect(sent[0].body).toEqual({
      dataRequest: {
        device: { type: 'Server', description: 'Cuadre Worker', ipAddress: '200.11.22.33' },
        securityAuth: { sessionId: 'cashier-session-1' },
        transaction: { referenceNumber: '000123456789' },
      },
    });
  });

  it('normalises the row into the port’s units', async () => {
    stubBank([found]);

    const outcome = await CLIENT.findByExactReference(CALL, '000123456789');

    expect(outcome).toEqual({ kind: 'movements', movements: [MOVEMENT] });
  });

  it('reports no results as an answer, not as a failure', async () => {
    stubBank([empty]);

    expect(await CLIENT.findByExactReference(CALL, '000123456789')).toEqual({ kind: 'no_results' });
  });

  it('reports an empty list as no results too', async () => {
    stubBank([{ status: 200, body: confirmationReply('200', []) }]);

    expect(await CLIENT.findByExactReference(CALL, '000123456789')).toEqual({ kind: 'no_results' });
  });

  it('maps the bank’s status code to a failure', async () => {
    stubBank([{ status: 200, body: confirmationReply('VRN04') }]);

    expect(await CLIENT.findByExactReference(CALL, '000123456789')).toEqual({
      kind: 'failure',
      failure: 'maintenance',
    });
  });

  it('refuses a row it cannot map rather than answering with a wrong amount', async () => {
    stubBank([
      {
        status: 200,
        body: confirmationReply('200', [{ ...DETAIL, amount: 'n/a' }]),
      },
    ]);

    expect(await CLIENT.findByExactReference(CALL, '000123456789')).toEqual({
      kind: 'failure',
      failure: 'unavailable',
    });
  });

  it('refuses a body that is not the reply at all', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }));

    expect(await CLIENT.findByExactReference(CALL, '000123456789')).toEqual({
      kind: 'failure',
      failure: 'unavailable',
    });
  });
});

describe('BanescoConfirmationClient.findByReferenceTail', () => {
  it('asks by the last six digits, the phone, the bank and the date', async () => {
    const sent = stubBank([found]);

    await CLIENT.findByReferenceTail(CALL, {
      reference: '000123456789',
      payerPhone: '584143125566',
      sourceBankId: '0134',
      onDate: '2026-08-06',
    });

    expect(transactionOf(sent[0])).toEqual({
      referenceNumber: '456789',
      phoneNum: '584143125566',
      bankId: '0134',
      startDt: '2026-08-06',
    });
  });
});

describe('BanescoConfirmationClient.listByAccountRange', () => {
  it('asks for the range on one account', async () => {
    const sent = stubBank([found]);

    await CLIENT.listByAccountRange(CALL, {
      accountId: '01340123450123458514',
      from: '2026-08-05',
      to: '2026-08-06',
    });

    expect(transactionOf(sent[0])).toEqual({
      accountId: '01340123450123458514',
      startDt: '2026-08-05',
      endDt: '2026-08-06',
    });
  });

  it('splits the range into days when the bank says it is too wide', async () => {
    const sent = stubBank([tooWide, found, empty]);

    const outcome = await CLIENT.listByAccountRange(CALL, {
      accountId: '01340123450123458514',
      from: '2026-08-05',
      to: '2026-08-06',
    });

    expect(sent).toHaveLength(3);
    expect(transactionOf(sent[1])).toMatchObject({ startDt: '2026-08-05', endDt: '2026-08-05' });
    expect(transactionOf(sent[2])).toMatchObject({ startDt: '2026-08-06', endDt: '2026-08-06' });
    expect(outcome).toEqual({ kind: 'movements', movements: [MOVEMENT] });
  });

  it('gives up when a single day still will not fit', async () => {
    stubBank([tooWide]);

    const outcome = await CLIENT.listByAccountRange(CALL, {
      accountId: '01340123450123458514',
      from: '2026-08-06',
      to: '2026-08-06',
    });

    expect(outcome).toEqual({ kind: 'failure', failure: 'unavailable' });
  });

  it.each([
    ['2026-08-01', '2026-09-30'],
    ['2026-08-06', '2026-08-05'],
    ['ayer', '2026-08-06'],
  ])('refuses the span %s → %s without calling the bank', async (from, to) => {
    const sent = stubBank([found]);

    const outcome = await CLIENT.listByAccountRange(CALL, {
      accountId: '01340123450123458514',
      from,
      to,
    });

    expect(sent).toHaveLength(0);
    expect(outcome).toEqual({ kind: 'failure', failure: 'invalid_input' });
  });
});
