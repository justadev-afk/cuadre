/**
 * The Worker's environment: platform bindings plus the vars and secrets.
 *
 * A missing binding must fail loudly and identically everywhere, not surface
 * as `undefined.prepare is not a function` three layers down at three in the
 * morning. `readVars` is the one parse, called from the container.
 */
import { z } from 'zod';

/** `[vars]` from wrangler.jsonc plus everything set with `wrangler secret put`. */
export const WorkerVars = z.object({
  ENVIRONMENT: z.enum(['development', 'production']),

  /**
   * The app's own origin. It is the base of every password-reset link and the
   * `iss` of the session cookie's scope — changing the route without changing
   * this breaks reset links in a way that only shows up in someone's inbox.
   */
  APP_BASE_URL: z.url(),

  MAIL_FROM: z.email(),
  SUPPORT_EMAIL: z.email(),

  /**
   * AES-GCM master key, base64 of 32 bytes. Seals bank client secrets and full
   * account numbers at rest. Rotating it means bumping `CURRENT_KEY_VERSION`
   * and keeping the old key readable — which is why every sealed row records
   * the version that wrote it.
   */
  CREDS_KEY: z.string().min(32),

  /**
   * Mixed into every IP hash. Raw IPs are never stored, not in
   * `password_resets` and not in the audit log.
   */
  IP_PEPPER: z.string().min(16),

  /**
   * The egress IP declared to each bank, sent as `device.ipAddress`. Banks
   * validate the caller by IP and Workers has no fixed one, so this is
   * whatever the resolution to that constraint produces (a dedicated egress
   * address or a fixed-IP relay). It is a var, not a literal, because it
   * changes independently of the code that sends it.
   */
  BANK_EGRESS_IP: z.string().min(7),
});

export type WorkerVars = z.infer<typeof WorkerVars>;

/** What `env` actually is at runtime: the parsed vars plus the platform bindings. */
export type Bindings = WorkerVars & {
  DB: D1Database;
  SESSIONS: KVNamespace;
  TOKENS: KVNamespace;
  JOBS: Queue<unknown>;
  EMAIL: SendEmail;
  METRICS: AnalyticsEngineDataset;
};

/**
 * Parse and narrow. Throws a plain `Error`: this runs before any request
 * context exists, so there is no request id to attach yet.
 */
export function readVars(env: unknown): WorkerVars {
  const parsed = WorkerVars.safeParse(env);
  if (parsed.success) return parsed.data;

  // Name the missing keys, never their values: this string reaches the logs.
  const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
  throw new Error(`Worker environment is incomplete or invalid: ${missing}`);
}
