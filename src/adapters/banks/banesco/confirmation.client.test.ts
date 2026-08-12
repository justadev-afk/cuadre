import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BanescoConfirmationCall, BanescoConfirmationClient } from './confirmation.client.ts';
import { serverDevice } from './envelope.ts';

const CLIENT = new BanescoConfirmationClient(serverDevice('200.11.22.33'), 'cuadre/1.0', false);

const CALL: BanescoConfirmationCall = {
  environment: 'sandbox',
  accessToken: 'header.payload.signature',
  sessionId: 'cashier-session-1',
};

const QUERY = {
  reference: '456789',
  payerPhone: '584143125566',
  sourceBankId: '0134',
  onDate: '2026-08-06',
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

describe('BanescoConfirmationClient.findPagoMovil', () => {
  /**
   * The table is the specification, and this row is the meeting: the bank told
   * us on 2026-08-11 that the payer's bank code and phone were not arriving.
   * Every request carries all four fields or this fails.
   */
  it('asks by the reference tail, the phone, the payer’s bank and the date', async () => {
    const sent = stubBank([found]);

    await CLIENT.findPagoMovil(CALL, QUERY);

    expect(sent[0].url).toContain('/transactions/financial-account/transactions');
    expect(sent[0].body).toEqual({
      dataRequest: {
        device: { type: 'Server', description: 'Cuadre Worker', ipAddress: '200.11.22.33' },
        securityAuth: { sessionId: 'cashier-session-1' },
        transaction: {
          referenceNumber: '456789',
          phoneNum: '584143125566',
          bankId: '0134',
          startDt: '2026-08-06',
        },
      },
    });
  });

  it('sends only the last six digits when a whole reference is pasted', async () => {
    const sent = stubBank([found]);

    await CLIENT.findPagoMovil(CALL, { ...QUERY, reference: '000123456789' });

    expect(transactionOf(sent[0])).toMatchObject({ referenceNumber: '456789' });
  });

  it('normalises the row into the port’s units', async () => {
    stubBank([found]);

    expect(await CLIENT.findPagoMovil(CALL, QUERY)).toEqual({
      kind: 'movements',
      movements: [MOVEMENT],
    });
  });

  it('reports no results as an answer, not as a failure', async () => {
    stubBank([empty]);

    expect(await CLIENT.findPagoMovil(CALL, QUERY)).toEqual({ kind: 'no_results' });
  });

  it('reports an empty list as no results too', async () => {
    stubBank([{ status: 200, body: confirmationReply('200', []) }]);

    expect(await CLIENT.findPagoMovil(CALL, QUERY)).toEqual({ kind: 'no_results' });
  });

  it('maps the bank’s status code to a failure', async () => {
    stubBank([{ status: 200, body: confirmationReply('VRN04') }]);

    expect(await CLIENT.findPagoMovil(CALL, QUERY)).toEqual({
      kind: 'failure',
      failure: 'maintenance',
    });
  });

  it('refuses a row it cannot map rather than answering with a wrong amount', async () => {
    stubBank([{ status: 200, body: confirmationReply('200', [{ ...DETAIL, amount: 'n/a' }]) }]);

    expect(await CLIENT.findPagoMovil(CALL, QUERY)).toEqual({
      kind: 'failure',
      failure: 'unavailable',
    });
  });

  it('refuses a body that is not the reply at all', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>502</html>', { status: 502 }));

    expect(await CLIENT.findPagoMovil(CALL, QUERY)).toEqual({
      kind: 'failure',
      failure: 'unavailable',
    });
  });
});

/**
 * The table is the specification, and here it has two rows because Banesco reads
 * a transferencia two ways. Which one travels is the payer's Sudeban code and
 * nothing else — the bank's desk told us on 2026-08-12 that they were seeing
 * only the internal shape arrive, and this is the pair of requests that answers
 * them.
 */
describe('BanescoConfirmationClient.findTransferencia', () => {
  const transfer = {
    reference: '00000150496',
    receivingAccount: '01340804108041005394',
    onDate: '2026-07-02',
  };

  it('asks Banesco→Banesco by the whole reference and the account, with NO date', async () => {
    // The omission is load-bearing: sending `startDt` turns a movement the bank
    // had just returned into `70001 · sin resultados`, verified against QA on
    // the transferencia's own reported date.
    const sent = stubBank([found]);

    await CLIENT.findTransferencia(CALL, { ...transfer, sourceBankId: '0134' });

    expect(transactionOf(sent[0])).toEqual({
      referenceNumber: '00000150496',
      accountId: '01340804108041005394',
      bankId: '0134',
    });
  });

  it('asks an interbank transferencia by the reference tail, the account, the bank and the date', async () => {
    // Manual V1.3: "Búsqueda por Referencia (últimos 6 dígitos) y Número de
    // Cuenta", added in that version "para solo Transferencias Interbancarias".
    const sent = stubBank([found]);

    await CLIENT.findTransferencia(CALL, { ...transfer, sourceBankId: '0102' });

    expect(transactionOf(sent[0])).toEqual({
      referenceNumber: '150496',
      accountId: '01340804108041005394',
      bankId: '0102',
      startDt: '2026-07-02',
    });
  });

  it('never carries a phone, whichever modality it is', async () => {
    const sent = stubBank([found, found]);

    await CLIENT.findTransferencia(CALL, { ...transfer, sourceBankId: '0134' });
    await CLIENT.findTransferencia(CALL, { ...transfer, sourceBankId: '0172' });

    for (const call of sent) expect(transactionOf(call)).not.toHaveProperty('phoneNum');
  });

  it('reports no results as an answer, not as a failure', async () => {
    stubBank([empty]);

    expect(await CLIENT.findTransferencia(CALL, { ...transfer, sourceBankId: '0102' })).toEqual({
      kind: 'no_results',
    });
  });
});
