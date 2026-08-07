/**
 * "Olvidé mi contraseña": mint a single-use token and mail a link.
 *
 * **The answer is the same whether or not the address is registered.** This use
 * case returns nothing at all, which is the shape that makes that hard to get
 * wrong later — there is no branch for a screen to render differently, and the
 * form says *si esa dirección tiene una cuenta, te enviamos un enlace* in both
 * cases. A reset form that confirms an address is a customer list anybody can
 * download one address at a time.
 *
 * **A cashier never gets one.** They have no email — the schema forbids it —
 * and their PIN is reset by the company they work for. The check is here anyway
 * so the rule does not quietly depend on a CHECK constraint staying put.
 *
 * The mail goes on the queue, never inline. SMTP at the far end of a form
 * submission is somebody staring at a spinner while a mail server thinks about
 * it, and a send that fails would fail the request that already did its work.
 */
import type { Clock } from '../../shared/clock.ts';
import { sha256Hex } from '../../shared/crypto.ts';
import type { IdGen } from '../../shared/id.ts';
import { logger } from '../../shared/logger.ts';
import { normaliseEmail } from './email.ts';

export type RequestPasswordResetInput = {
  readonly email: string;
  /** `hashIp()` output. `password_resets.requested_ip` never holds an address. */
  readonly ipHash: string;
};

/** What this use case needs off a user row. Notably not the password hash. */
export type ResettableUser = {
  readonly id: string;
  readonly role: string;
  readonly name: string;
  readonly email: string | null;
  readonly status: string;
};

export type NewPasswordResetToken = {
  /** The SHA-256. The token itself is never stored, only mailed. */
  readonly tokenHash: string;
  readonly userId: string;
  readonly expiresAt: number;
  readonly requestedIpHash: string | null;
  readonly createdAt: number;
};

/**
 * The job as the consumer in `src/adapters/queue/consumer.ts` parses it. The
 * port is `enqueue` and nothing else: a use case that can inspect the queue is
 * a use case that will eventually wait on it.
 */
export type PasswordResetJob = {
  readonly kind: 'send_password_reset';
  readonly to: string;
  readonly resetUrl: string;
  readonly name: string;
};

export type JobQueue = {
  enqueue(job: PasswordResetJob): Promise<void>;
};

export type RequestPasswordResetDeps = {
  readonly users: { findByEmail(email: string): Promise<ResettableUser | null> };
  readonly resets: {
    create(input: NewPasswordResetToken): Promise<void>;
    invalidateAllForUser(userId: string, at: number): Promise<number>;
    countRecentForUser(userId: string, since: number): Promise<number>;
  };
  readonly jobs: JobQueue;
  readonly clock: Clock;
  readonly ids: IdGen;
  /** `APP_BASE_URL`. The link has to resolve for whoever opens it in their mail. */
  readonly appBaseUrl: string;
};

export type RequestPasswordReset = (input: RequestPasswordResetInput) => Promise<void>;

/**
 * Thirty minutes, and the mail says so before the reader clicks. Long enough
 * for somebody to find the message, short enough that a link left in an inbox
 * is not a standing key to the account.
 */
export const RESET_TOKEN_TTL_SECONDS = 30 * 60;

/**
 * Three an hour, counted per user. The cap is enforced by sending nothing —
 * refusing out loud would be a different answer for a registered address than
 * for an unregistered one, which is the leak this whole file is arranged
 * against.
 */
export const MAX_RESETS_PER_HOUR = 3;

const HOUR = 60 * 60;

const RESET_PATH = '/reset-password';

export function makeRequestPasswordReset(deps: RequestPasswordResetDeps): RequestPasswordReset {
  return async (input) => {
    const email = normaliseEmail(input.email);
    const user = await deps.users.findByEmail(email);

    if (user === null || user.email === null) return;
    if (user.role === 'cashier') return;
    if (user.status !== 'active') return;

    const now = deps.clock.nowSeconds();
    const recent = await deps.resets.countRecentForUser(user.id, now - HOUR);
    if (recent >= MAX_RESETS_PER_HOUR) {
      // Worth a line: three in an hour is either somebody stuck or somebody
      // being mailed on purpose, and both are things support should be able to
      // see. The address is not logged; the user id is enough to find it.
      logger.warn('password_reset_capped', { userId: user.id });
      return;
    }

    // Every outstanding token dies as the new one is born. Two live links to
    // the same account means the older mail — the one more likely to have been
    // forwarded, or read over a shoulder — still opens the door.
    await deps.resets.invalidateAllForUser(user.id, now);

    const token = deps.ids.token();
    await deps.resets.create({
      tokenHash: await sha256Hex(token),
      userId: user.id,
      expiresAt: now + RESET_TOKEN_TTL_SECONDS,
      requestedIpHash: input.ipHash,
      createdAt: now,
    });

    await deps.jobs.enqueue({
      kind: 'send_password_reset',
      to: user.email,
      resetUrl: resetUrl(deps.appBaseUrl, token),
      name: user.name,
    });

    // Never the token, and never the link that carries it.
    logger.info('password_reset_requested', { userId: user.id });
  };
}

/** `URL` rather than a template so a trailing slash on `APP_BASE_URL` cannot double up. */
function resetUrl(baseUrl: string, token: string): string {
  const url = new URL(RESET_PATH, baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
}
