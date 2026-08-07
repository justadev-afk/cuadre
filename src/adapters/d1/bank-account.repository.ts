/**
 * The bank affiliations a company has connected, and the OAuth credential pairs
 * each one holds.
 *
 * This repository moves sealed bytes and never holds the key. `CREDS_KEY` is
 * not a dependency here and must not become one: a row read out of this file is
 * a `Sealed` envelope, and the only thing that can turn it back into a client
 * secret is `unseal`, called by the layer that has a reason to.
 *
 * An account's credentials live in their own table, `bank_account_credentials`,
 * one row per pair (see migration 0003). This repository is the seam that hides
 * that: it loads an account together with its credential rows and returns a
 * single `BankAccount`, and it writes both together in one batch. Nothing
 * upstream knows the credentials are a separate table.
 *
 * Nothing is ever hard-deleted. `validations.bank_account_id` points here and
 * that history has to keep resolving years after a company changes banks, so
 * `remove` is a status change — which is why `status` has a 'removed' value at
 * all.
 */
import type {
  BankCredentialUsage,
  BankEnvironment,
  BankId,
} from '../../application/ports/bank-gateway.ts';
import type { Sealed } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { isUniqueIndex, readConstraintFailure, type UniqueIndex } from './constraint-error.ts';
import { bytes, type D1Row, integer, optionalInteger, optionalText, text } from './row.ts';

export type BankAccountStatus = 'active' | 'needs_reverify' | 'removed';

/** One OAuth credential pair an account holds, as a row keeps it. Sealed. */
export type StoredCredential = {
  /** The bank's credential-group key (Banesco: 'confirmation', 'consulta'). */
  readonly credKey: string;
  /** What the pair is for. See `bank-gateway.ts`. */
  readonly usage: BankCredentialUsage;
  /** Safe to render. The whole client id is inside `credentials`. */
  readonly clientIdLast6: string | null;
  /** The `{clientId, clientSecret}` pair, sealed. Never decrypted in this file. */
  readonly credentials: Sealed;
};

/** A credential pair on its way to a row: the same shape, plus the row id. */
export type NewStoredCredential = StoredCredential & { readonly id: string };

export type BankAccount = {
  readonly id: string;
  readonly companyId: string;
  /** The registry key of the gateway that speaks to it. */
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  /** Safe to render: the operate pair's tail. The whole id is in `credentials`. */
  readonly clientIdLast6: string | null;
  /** The full account number, sealed. */
  readonly accountNumber: Sealed;
  /** Safe to render, and the fourth column of the per-company unique key. */
  readonly accountLast4: string;
  readonly accountType: string | null;
  readonly holderId: string | null;
  /** Every credential pair the account holds, loaded from its own table. */
  readonly credentials: readonly StoredCredential[];
  readonly verifiedAt: number | null;
  readonly credsExpireAt: number | null;
  readonly status: BankAccountStatus;
  readonly createdAt: number;
};

export type NewBankAccount = {
  readonly id: string;
  readonly companyId: string;
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  readonly clientIdLast6: string | null;
  readonly accountNumber: Sealed;
  readonly accountLast4: string;
  readonly accountType: string | null;
  readonly holderId: string | null;
  /** At least one pair — a bank without credentials cannot be validated. */
  readonly credentials: readonly NewStoredCredential[];
  readonly credsExpireAt: number | null;
  readonly createdAt: number;
};

export type BankAccountWriteFailure = 'account_already_linked' | 'unknown_company' | 'not_found';

export interface BankAccountRepository {
  insert(input: NewBankAccount): Promise<Result<BankAccount, BankAccountWriteFailure>>;
  findById(id: string): Promise<BankAccount | null>;
  listByCompany(companyId: string, includeRemoved?: boolean): Promise<readonly BankAccount[]>;
  /** The account the counter will use for this environment, or `null`. */
  findActiveForCompany(
    companyId: string,
    environment: BankEnvironment,
  ): Promise<BankAccount | null>;
  /**
   * Every usable account for this environment, most-recently-verified first —
   * what the counter asks in turn when no single account is chosen. A merchant
   * with two receiving accounts has the payment on exactly one of them, and this
   * is the list the use case walks until the bank reports it.
   */
  listActiveForCompany(
    companyId: string,
    environment: BankEnvironment,
  ): Promise<readonly BankAccount[]>;
  markVerified(
    id: string,
    at: number,
    credsExpireAt: number | null,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>>;
  setStatus(
    id: string,
    status: BankAccountStatus,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>>;
  /** A soft delete. See the note at the top of this file. */
  remove(id: string): Promise<Result<BankAccount, BankAccountWriteFailure>>;
  /**
   * Replaces every credential pair on the account with a new set (re-stamping
   * `verified_at` and clearing `needs_reverify`) — never touching the account
   * number, the bank, or the environment. The old rows are deleted and the new
   * ones written in one batch, so a caller never sees a half-swapped account.
   */
  replaceCredentials(
    id: string,
    credentials: readonly NewStoredCredential[],
    clientIdLast6: string | null,
    verifiedAt: number,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>>;
}

/**
 * A table-level UNIQUE, so SQLite has no name for it beyond the automatic one
 * and reports the four columns instead. Matching on the columns is what
 * actually fires.
 */
const ACCOUNT_INDEX: UniqueIndex = {
  name: 'sqlite_autoindex_bank_accounts_1',
  columns: [
    'bank_accounts.company_id',
    'bank_accounts.bank',
    'bank_accounts.environment',
    'bank_accounts.account_last4',
  ],
};

const COLUMNS = `id, company_id, bank, environment, client_id_last6,
                 account_ct, account_iv, account_key_v, account_last4, account_type, holder_id,
                 verified_at, creds_expire_at, status, created_at`;

/** The credential-row columns, minus `bank_account_id` which grouping selects. */
const CRED_COLUMNS = `id, cred_key, usage, client_id_last6, creds_ct, creds_iv, creds_key_v, created_at`;

export class D1BankAccountRepository implements BankAccountRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<BankAccount | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM bank_accounts WHERE id = ?`)
      .bind(id)
      .first<D1Row>();
    return row === null ? null : this.hydrate(row);
  }

  async insert(input: NewBankAccount): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    // The invariant, enforced at the only place that writes an account: no
    // account without credentials. The type says "at least one pair" and every
    // caller honours it, but this is the choke point that makes it true rather
    // than intended — an empty set here would mint an account nothing can
    // validate, the exact zombie row migration 0003 exists to abolish.
    if (input.credentials.length === 0) {
      throw new AppError('internal', 'bank account insert requires at least one credential pair');
    }

    const account = this.db
      .prepare(
        `INSERT INTO bank_accounts
             (id, company_id, bank, environment, client_id_last6,
              account_ct, account_iv, account_key_v, account_last4, account_type, holder_id,
              creds_expire_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           RETURNING ${COLUMNS}`,
      )
      .bind(
        input.id,
        input.companyId,
        input.bank,
        input.environment,
        input.clientIdLast6,
        input.accountNumber.ciphertext,
        input.accountNumber.iv,
        input.accountNumber.keyVersion,
        input.accountLast4,
        input.accountType,
        input.holderId,
        input.credsExpireAt,
        input.createdAt,
      );
    const credentials = input.credentials.map((cred) =>
      this.credInsert(input.id, cred, input.createdAt),
    );

    try {
      // One batch, one transaction: the account and every credential pair land
      // together or not at all. A partial write — an account nobody can validate
      // — is exactly what this avoids.
      const results = await this.db.batch<D1Row>([account, ...credentials]);
      const row = results[0]?.results[0];
      if (row === undefined) throw new AppError('internal', 'bank account insert returned no row');
      return ok(toBankAccount(row, input.credentials.map(toStored)));
    } catch (error) {
      const failure = readConstraintFailure(error);
      if (failure === null) throw error;
      if (isUniqueIndex(failure, ACCOUNT_INDEX)) return err('account_already_linked');
      if (failure.kind === 'foreign_key') return err('unknown_company');
      throw error;
    }
  }

  async listByCompany(companyId: string, includeRemoved = false): Promise<readonly BankAccount[]> {
    const page = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM bank_accounts
            WHERE company_id = ? AND (? = 1 OR status <> 'removed')
            ORDER BY created_at DESC`,
      )
      .bind(companyId, includeRemoved ? 1 : 0)
      .all<D1Row>();
    return this.hydrateAll(page.results);
  }

  /**
   * `needs_reverify` counts as usable. That flag is a seven-day warning that
   * QA credentials are about to expire, not a revocation — refusing to serve
   * it would close a merchant's counter a week before anything is actually
   * wrong. The bank remains the authority on whether the credentials still
   * work, and it says so by rejecting them.
   *
   * A company is expected to have one account per environment. If it somehow
   * has two, the most recently verified wins, so the choice is at least
   * deterministic instead of whatever the planner returns first.
   */
  async findActiveForCompany(
    companyId: string,
    environment: BankEnvironment,
  ): Promise<BankAccount | null> {
    const row = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM bank_accounts
            WHERE company_id = ? AND environment = ? AND status <> 'removed'
            ORDER BY (status = 'active') DESC, verified_at DESC, created_at DESC
            LIMIT 1`,
      )
      .bind(companyId, environment)
      .first<D1Row>();
    return row === null ? null : this.hydrate(row);
  }

  async listActiveForCompany(
    companyId: string,
    environment: BankEnvironment,
  ): Promise<readonly BankAccount[]> {
    const page = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM bank_accounts
            WHERE company_id = ? AND environment = ? AND status <> 'removed'
            ORDER BY (status = 'active') DESC, verified_at DESC, created_at DESC`,
      )
      .bind(companyId, environment)
      .all<D1Row>();
    return this.hydrateAll(page.results);
  }

  /**
   * Verification is also what clears `needs_reverify`; there is no separate
   * "un-warn" call. A removed account stays removed — re-connecting a bank is
   * a new row, not a resurrection of one whose `id` history still points at.
   */
  markVerified(
    id: string,
    at: number,
    credsExpireAt: number | null,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    return this.writeAndReturn(
      `UPDATE bank_accounts
            SET verified_at = ?, creds_expire_at = ?, status = 'active'
          WHERE id = ? AND status <> 'removed'
          RETURNING ${COLUMNS}`,
      [at, credsExpireAt, id],
    );
  }

  setStatus(
    id: string,
    status: BankAccountStatus,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    return this.writeAndReturn(
      `UPDATE bank_accounts SET status = ? WHERE id = ? RETURNING ${COLUMNS}`,
      [status, id],
    );
  }

  remove(id: string): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    return this.writeAndReturn(
      `UPDATE bank_accounts SET status = 'removed' WHERE id = ? RETURNING ${COLUMNS}`,
      [id],
    );
  }

  async replaceCredentials(
    id: string,
    credentials: readonly NewStoredCredential[],
    clientIdLast6: string | null,
    verifiedAt: number,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    // The caller (change-bank-credentials) has already established the account
    // is the merchant's and not removed. The UPDATE's `status <> 'removed'`
    // guard is the last line: if it matches nothing the account vanished under
    // us and the whole batch is reported as not_found.
    const clear = this.db
      .prepare('DELETE FROM bank_account_credentials WHERE bank_account_id = ?')
      .bind(id);
    const written = credentials.map((cred) => this.credInsert(id, cred, verifiedAt));
    const account = this.db
      .prepare(
        `UPDATE bank_accounts
              SET client_id_last6 = ?, verified_at = ?, status = 'active'
            WHERE id = ? AND status <> 'removed'
            RETURNING ${COLUMNS}`,
      )
      .bind(clientIdLast6, verifiedAt, id);

    const results = await this.db.batch<D1Row>([clear, ...written, account]);
    const row = results[results.length - 1]?.results[0];
    if (row === undefined) return err('not_found');
    return ok(toBankAccount(row, credentials.map(toStored)));
  }

  private credInsert(
    accountId: string,
    cred: NewStoredCredential,
    createdAt: number,
  ): D1PreparedStatement {
    return this.db
      .prepare(
        `INSERT INTO bank_account_credentials
             (id, bank_account_id, cred_key, usage, client_id_last6,
              creds_ct, creds_iv, creds_key_v, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        cred.id,
        accountId,
        cred.credKey,
        cred.usage,
        cred.clientIdLast6,
        cred.credentials.ciphertext,
        cred.credentials.iv,
        cred.credentials.keyVersion,
        createdAt,
      );
  }

  /** The credential rows for a set of accounts, grouped by account id. */
  private async credentialsFor(
    accountIds: readonly string[],
  ): Promise<Map<string, StoredCredential[]>> {
    const byAccount = new Map<string, StoredCredential[]>();
    if (accountIds.length === 0) return byAccount;

    const placeholders = accountIds.map(() => '?').join(', ');
    const page = await this.db
      .prepare(
        `SELECT bank_account_id, ${CRED_COLUMNS} FROM bank_account_credentials
            WHERE bank_account_id IN (${placeholders})
            ORDER BY created_at ASC, id ASC`,
      )
      .bind(...accountIds)
      .all<D1Row>();

    for (const row of page.results) {
      const accountId = text(row, 'bank_account_id');
      const list = byAccount.get(accountId) ?? [];
      list.push(toStoredCredential(row));
      byAccount.set(accountId, list);
    }
    return byAccount;
  }

  private async hydrate(row: D1Row): Promise<BankAccount> {
    const id = text(row, 'id');
    const credentials = (await this.credentialsFor([id])).get(id) ?? [];
    return toBankAccount(row, credentials);
  }

  private async hydrateAll(rows: readonly D1Row[]): Promise<BankAccount[]> {
    const ids = rows.map((row) => text(row, 'id'));
    const byAccount = await this.credentialsFor(ids);
    return rows.map((row) => toBankAccount(row, byAccount.get(text(row, 'id')) ?? []));
  }

  private async writeAndReturn(
    sql: string,
    args: readonly unknown[],
  ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    const row = await this.db
      .prepare(sql)
      .bind(...args)
      .first<D1Row>();
    return row === null ? err('not_found') : ok(await this.hydrate(row));
  }
}

export function toBankAccount(row: D1Row, credentials: readonly StoredCredential[]): BankAccount {
  return {
    id: text(row, 'id'),
    companyId: text(row, 'company_id'),
    bank: text(row, 'bank'),
    environment: toEnvironment(text(row, 'environment')),
    clientIdLast6: optionalText(row, 'client_id_last6'),
    accountNumber: {
      ciphertext: bytes(row, 'account_ct'),
      iv: bytes(row, 'account_iv'),
      keyVersion: integer(row, 'account_key_v'),
    },
    accountLast4: text(row, 'account_last4'),
    accountType: optionalText(row, 'account_type'),
    holderId: optionalText(row, 'holder_id'),
    credentials,
    verifiedAt: optionalInteger(row, 'verified_at'),
    credsExpireAt: optionalInteger(row, 'creds_expire_at'),
    status: toStatus(text(row, 'status')),
    createdAt: integer(row, 'created_at'),
  };
}

export function toStoredCredential(row: D1Row): StoredCredential {
  return {
    credKey: text(row, 'cred_key'),
    usage: toUsage(text(row, 'usage')),
    clientIdLast6: optionalText(row, 'client_id_last6'),
    credentials: {
      ciphertext: bytes(row, 'creds_ct'),
      iv: bytes(row, 'creds_iv'),
      keyVersion: integer(row, 'creds_key_v'),
    },
  };
}

/** Drops the row id: what a consumer of an account reads back. */
function toStored(cred: NewStoredCredential): StoredCredential {
  return {
    credKey: cred.credKey,
    usage: cred.usage,
    clientIdLast6: cred.clientIdLast6,
    credentials: cred.credentials,
  };
}

/** Fails closed: an environment this build cannot read is not production. */
function toEnvironment(value: string): BankEnvironment {
  return value === 'production' ? 'production' : 'sandbox';
}

/** Fails closed: an account whose status is unreadable does not take payments. */
function toStatus(value: string): BankAccountStatus {
  if (value === 'active' || value === 'needs_reverify') return value;
  return 'removed';
}

/**
 * Fails closed to 'discover': a pair whose usage is unreadable is never picked
 * as the operate one while another pair could be. A lone pair is used anyway,
 * by the single-credential rule in `operateCredential`.
 */
function toUsage(value: string): BankCredentialUsage {
  return value === 'operate' ? 'operate' : 'discover';
}
