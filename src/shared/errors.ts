/**
 * The only place that turns an error into an HTTP response.
 *
 * Expected domain failures are `Result` return values, not exceptions. An
 * `AppError` is for what a handler genuinely cannot continue past: no session,
 * a company that is not yours, a bank that will not answer at all.
 */
import { ZodError } from 'zod';

import { logger } from './logger.ts';

/**
 * Every code the app can answer with. The UI branches on these strings, so
 * adding one is additive and renaming one is a breaking change.
 */
export type ErrorCode =
  // generic
  | 'invalid_request'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'internal'
  // bank onboarding
  | 'bank_rejected_credentials'
  | 'bank_environment_mismatch'
  | 'bank_no_accounts'
  | 'bank_unsupported'
  // bank at the counter
  | 'bank_maintenance'
  | 'bank_unavailable'
  | 'bank_timeout'
  // checkout
  | 'payment_already_charged';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  invalid_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
  bank_rejected_credentials: 400,
  bank_environment_mismatch: 409,
  bank_no_accounts: 409,
  bank_unsupported: 400,
  bank_maintenance: 503,
  bank_unavailable: 502,
  bank_timeout: 504,
  payment_already_charged: 409,
};

/**
 * User-facing copy, in Spanish — this is the one place in the codebase where
 * that is true, and it is deliberate: an error the user reads must not be
 * assembled from a code in a component. Everything else here is English.
 */
const MESSAGE_BY_CODE: Record<ErrorCode, string> = {
  invalid_request: 'Revisa los datos e intenta de nuevo.',
  unauthenticated: 'Tu sesión no es válida. Entra de nuevo.',
  forbidden: 'No tienes acceso a esto.',
  not_found: 'No encontramos lo que buscas.',
  conflict: 'Ese cambio choca con el estado actual.',
  rate_limited: 'Demasiados intentos. Espera un momento.',
  internal: 'Algo falló de nuestro lado.',
  bank_rejected_credentials: 'El banco rechazó las credenciales.',
  bank_environment_mismatch: 'Estas credenciales no son del entorno que declaraste.',
  bank_no_accounts: 'Esta afiliación no tiene cuentas visibles.',
  bank_unsupported: 'Ese banco todavía no está disponible.',
  bank_maintenance: 'El banco está en mantenimiento.',
  bank_unavailable: 'El banco no pudo responder.',
  bank_timeout: 'Tardó demasiado, intenta de nuevo.',
  payment_already_charged: 'Ese pago ya fue cobrado.',
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Never reaches the client. For the log line only. */
  readonly detail?: string;

  constructor(code: ErrorCode, detail?: string, message?: string) {
    super(message ?? MESSAGE_BY_CODE[code]);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.detail = detail;
  }
}

export const unauthenticated = (detail?: string) => new AppError('unauthenticated', detail);
export const forbidden = (detail?: string) => new AppError('forbidden', detail);
export const notFound = (detail?: string) => new AppError('not_found', detail);
export const invalidRequest = (detail?: string) => new AppError('invalid_request', detail);

export type ErrorBody = {
  error: { code: ErrorCode; message: string; request_id: string };
};

export function errorBody(code: ErrorCode, message: string, requestId: string): ErrorBody {
  return { error: { code, message, request_id: requestId } };
}

/** The single error → HTTP mapping. Nothing else builds an error response. */
export function toResponse(e: unknown, requestId: string): Response {
  if (e instanceof AppError) {
    const fields = { requestId, code: e.code, detail: e.detail };
    if (e.status >= 500) logger.error('app_error', fields);
    else logger.warn('app_error', fields);
    return json(e.status, errorBody(e.code, e.message, requestId), e.status === 429);
  }

  if (e instanceof ZodError) {
    // The issue paths say which field, without echoing the value back — the
    // values here are references, phone numbers and client secrets.
    const where = e.issues.map((i) => i.path.join('.')).join(', ');
    logger.warn('validation_error', { requestId, where });
    return json(400, errorBody('invalid_request', MESSAGE_BY_CODE.invalid_request, requestId));
  }

  logger.error('unhandled', { requestId, err: serialise(e) });
  return json(500, errorBody('internal', MESSAGE_BY_CODE.internal, requestId));
}

function json(status: number, body: ErrorBody, retryable = false): Response {
  const headers: Record<string, string> = {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-request-id': body.error.request_id,
  };
  if (retryable) headers['retry-after'] = '60';
  return new Response(JSON.stringify(body), { status, headers });
}

function serialise(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return String(e);
}
