/**
 * Wiring: adapters are built from `env`, use cases are built from adapters.
 *
 * This is the one module that knows every concrete class exists. A page or a
 * route handler asks the container for a use case and never constructs an
 * adapter itself — that is what keeps `new D1UserRepository` out of the request
 * handlers, where a test would then need the real database to reach it.
 *
 * `env` is parsed once here, at the top, so a missing binding fails with a
 * named key rather than as `undefined.prepare` three layers down.
 */

import { BankRegistry } from './adapters/banks/registry.ts';
import { D1BankAccountRepository } from './adapters/d1/bank-account.repository.ts';
import { D1CompanyRepository } from './adapters/d1/company.repository.ts';
import { D1PasswordResetRepository } from './adapters/d1/password-reset.repository.ts';
import { D1UserRepository } from './adapters/d1/user.repository.ts';
import { D1ValidationRepository } from './adapters/d1/validation.repository.ts';
import { KvRateLimiter } from './adapters/kv/rate-limit.store.ts';
import { KvSessionStore } from './adapters/kv/session.store.ts';
import { KvVerificationStore } from './adapters/kv/verification.store.ts';
import { AnalyticsEngineAttemptMetrics } from './adapters/metrics/attempt.metrics.ts';
import { makeAuthUseCases } from './application/auth/factory.ts';
import { makeBankingUseCases } from './application/banking/factory.ts';
import { makeCompanyUseCases } from './application/companies/factory.ts';
import { makeEmployeeUseCases } from './application/employees/factory.ts';
import { makeValidationUseCases } from './application/validations/factory.ts';
import { type Bindings, readVars } from './env.ts';
import { type Clock, systemClock } from './shared/clock.ts';
import { hashPassword, verifyPassword } from './shared/crypto.ts';
import { type IdGen, systemIdGen } from './shared/id.ts';

/**
 * The user agent every bank sees. Version it, because a bank's support desk
 * reads it back to us when a call misbehaves.
 */
const BANK_USER_AGENT = 'Cuadre/1.0';

/**
 * Builds everything from `env` and returns the use cases grouped by area.
 *
 * Cheap enough to do per request: the repositories are prepared-statement
 * wrappers holding a `D1Database` reference, the stores hold a KV binding, and
 * nothing here opens a connection. Doing it per request is also what keeps a
 * bank session — the token map inside a gateway — from outliving the request
 * that unsealed the credentials behind it (`BankRegistry` is rebuilt each time
 * for exactly this reason).
 */
export function buildContainer(rawEnv: Bindings) {
  const vars = readVars(rawEnv);
  const clock: Clock = systemClock;
  const ids: IdGen = systemIdGen;

  // Adapters.
  const users = new D1UserRepository(rawEnv.DB);
  const companies = new D1CompanyRepository(rawEnv.DB);
  const bankAccounts = new D1BankAccountRepository(rawEnv.DB);
  const validationRows = new D1ValidationRepository(rawEnv.DB);
  const resets = new D1PasswordResetRepository(rawEnv.DB);

  const sessions = new KvSessionStore(rawEnv.SESSIONS, clock);
  const limiter = new KvRateLimiter(rawEnv.SESSIONS, clock);
  const verifications = new KvVerificationStore(rawEnv.TOKENS);
  const metrics = new AnalyticsEngineAttemptMetrics(rawEnv.METRICS);

  // The gateway caches its own OAuth tokens straight into this namespace
  // (`BanescoOauthClient` does its own get/put with a TTL), so the binding is
  // handed over raw. There is no separate token-store object in the path.
  const banks = new BankRegistry({
    tokens: rawEnv.TOKENS,
    egressIp: vars.BANK_EGRESS_IP,
    userAgent: BANK_USER_AGENT,
  });

  // Ports the use cases declare, satisfied by shared functions and bindings.
  const passwords = { hash: hashPassword, verify: verifyPassword };
  const jobs = {
    enqueue: async (job: unknown): Promise<void> => {
      await rawEnv.JOBS.send(job);
    },
  };

  // Use cases, grouped by area. Each factory takes an object it structurally
  // matches out of what is built above — no factory names a concrete class.
  return {
    vars,
    auth: makeAuthUseCases({
      users,
      companies,
      resets,
      sessions,
      limiter,
      passwords,
      jobs,
      clock,
      ids,
      appBaseUrl: vars.APP_BASE_URL,
    }),
    // These two spell the id-generator port `idGen`; the others spell it `ids`.
    // The container is the one place both names meet, so it just passes each.
    companies: makeCompanyUseCases({ companies, users, bankAccounts, clock, idGen: ids }),
    employees: makeEmployeeUseCases({ users, sessions, clock, idGen: ids }),
    banking: makeBankingUseCases({
      banks,
      accounts: bankAccounts,
      verifications,
      credsKey: vars.CREDS_KEY,
      clock,
      ids,
    }),
    validations: makeValidationUseCases({
      validations: validationRows,
      accounts: bankAccounts,
      banks,
      metrics,
      credsKey: vars.CREDS_KEY,
      clock,
      ids,
    }),
  };
}

export type Container = ReturnType<typeof buildContainer>;
