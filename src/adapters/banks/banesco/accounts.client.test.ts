import { afterEach, describe, expect, it, vi } from 'vitest';

import { type BanescoAccountsCall, BanescoAccountsClient } from './accounts.client.ts';
import { serverDevice } from './envelope.ts';

const CLIENT = new BanescoAccountsClient(serverDevice('200.11.22.33'), 'cuadre/1.0');

const CALL: BanescoAccountsCall = {
  environment: 'sandbox',
  accessToken: 'header.payload.signature',
};

type Sent = { url: string; body: Record<string, unknown> };

function stubBank(status: number, body: unknown): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(body), { status });
  });
  return sent;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The reply envelope from Consulta de Cuentas V2.0 §V.b — `httpStatus` beside
 * `dataResponse`, and `dataResponse` is the account array itself. Written as a
 * builder so a future drift in the envelope is one edit, not twelve.
 */
function accountsReply(statusCode: string, dataResponse: unknown) {
  return { httpStatus: { statusCode, statusDesc: 'OK' }, dataResponse };
}

describe('BanescoAccountsClient.listProducts', () => {
  it('identifies the caller and asks nothing else', async () => {
    const sent = stubBank(200, accountsReply('200', [{ accountId: '0134************8514' }]));

    await CLIENT.listProducts(CALL);

    expect(sent[0].url).toContain('/customer/products');
    expect(sent[0].body).toEqual({
      dataRequest: {
        device: { type: 'Server', description: 'Cuadre Worker', ipAddress: '200.11.22.33' },
      },
    });
  });

  it('maps a product to the summary the picker renders', async () => {
    stubBank(
      200,
      // The manual's own example account is masked. Three fields, no more:
      // this service has no productType, no currencyCode and no customerId.
      accountsReply('200', [
        { accountId: '0134************8514', accountType: 'DDA', balance: 15340.75 },
      ]),
    );

    expect(await CLIENT.listProducts(CALL)).toEqual({
      ok: true,
      value: [
        {
          accountId: '0134************8514',
          masked: '0134************8514',
          type: 'DDA',
          balanceCents: 1_534_075,
          // Consulta de Cuentas carries no holder. The RIF arrives on the
          // confirmation reply as `customerIdBen` instead.
          holderId: null,
        },
      ],
    });
  });

  it('leaves a balance it cannot parse unknown rather than showing a zero', async () => {
    stubBank(200, accountsReply('200', [{ accountId: '0134************8514', balance: 'n/d' }]));

    const result = await CLIENT.listProducts(CALL);

    expect(result).toMatchObject({ ok: true, value: [{ balanceCents: null }] });
  });

  it.each([
    ['204', []],
    ['200', []],
  ])('reports no accounts for status %s with %j', async (statusCode, products) => {
    stubBank(200, accountsReply(statusCode, products));

    expect(await CLIENT.listProducts(CALL)).toEqual({ ok: false, error: 'no_accounts' });
  });

  it('maps the bank’s rejection onto the port’s vocabulary', async () => {
    stubBank(200, accountsReply('VRN01', null));

    expect(await CLIENT.listProducts(CALL)).toEqual({ ok: false, error: 'rejected_credentials' });
  });
});
