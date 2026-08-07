/**
 * The envelope every Banesco request is wrapped in.
 *
 * Both services take a `dataRequest` object and identify the caller by a
 * `device` block whose `ipAddress` the bank checks against the address it
 * whitelisted for us — which is why the egress IP is a deployment concern
 * (`BANK_EGRESS_IP`) and not a constant.
 *
 * This vocabulary — `dataRequest`, `device`, `securityAuth` — stops at the edge
 * of this folder. Nothing above the adapter knows the bank asks for any of it.
 */

/**
 * `type` is the bank's enumeration of callers. We are always a server: there is
 * no Cuadre code running on a phone that talks to a bank.
 */
export type BanescoDevice = {
  type: 'Server';
  description: string;
  ipAddress: string;
};

const DEVICE_DESCRIPTION = 'Cuadre Worker';

export function serverDevice(egressIp: string): BanescoDevice {
  return { type: 'Server', description: DEVICE_DESCRIPTION, ipAddress: egressIp };
}

/**
 * A handle the bank's support desk can quote back at us. It is our cashier
 * session id on a payment lookup and our own correlation id everywhere else —
 * never anything secret, since it travels in a body we do not control.
 */
export type BanescoSecurityAuth = { sessionId: string };

export type BanescoEnvelope<T> = {
  dataRequest: {
    device: BanescoDevice;
    securityAuth?: BanescoSecurityAuth;
    transaction?: T;
  };
};

export function dataRequest<T>(parts: {
  device: BanescoDevice;
  securityAuth?: BanescoSecurityAuth;
  transaction?: T;
}): BanescoEnvelope<T> {
  return { dataRequest: { ...parts } };
}

/**
 * And the envelope every Banesco *response* arrives in.
 *
 * Both manuals (Confirmación de Transacciones V1.3 §V.b, Consulta de Cuentas
 * V2.0 §V.b) show the same two-key shape, for success and for failure alike:
 *
 *   { "httpStatus": { "statusCode": "200", "statusDesc": "OK" },
 *     "dataResponse": … }        // null on failure
 *
 * **The status is inside `httpStatus`, not at the top level.** The first
 * implementation here read a flat `{statusCode, …}` — inferred before the
 * manuals were readable — which would have failed to parse every single reply
 * the bank ever sent and reported it as `unavailable`. It is parsed in one
 * place now so the two services cannot drift apart again.
 *
 * `dataResponse` differs between them and is passed in by the caller:
 * an array of accounts for the inquiry, an object holding `transactionDetail`
 * for the confirmation.
 */
import { z } from 'zod';

export const HttpStatus = z.object({
  /** '200', '70001', 'VRN01' — a string in the manual, a number in the wild. */
  statusCode: z.union([z.string(), z.number()]),
  statusDesc: z.string().nullish(),
});

export function bankReply<T extends z.ZodTypeAny>(dataResponse: T) {
  return z.object({
    httpStatus: HttpStatus,
    dataResponse: dataResponse.nullish(),
  });
}
