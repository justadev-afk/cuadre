/**
 * The bank affiliations a company has connected.
 *
 * This repository moves sealed bytes and never holds the key. `CREDS_KEY` is
 * not a dependency here and must not become one: a row read out of this file is
 * a `Sealed` envelope, and the only thing that can turn it back into a client
 * secret is `unseal`, called by the layer that has a reason to.
 *
 * Nothing is ever hard-deleted. `validations.bank_account_id` points here and
 * that history has to keep resolving years after a company changes banks, so
 * `remove` is a status change — which is why `status` has a 'removed' value at
 * all.
 */
import type { BankEnvironment, BankId } from '../../application/ports/bank-gateway.ts';
import type { Sealed } from '../../shared/crypto.ts';
import { AppError } from '../../shared/errors.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { isUniqueIndex, readConstraintFailure, type UniqueIndex } from './constraint-error.ts';
import { bytes, type D1Row, integer, optionalInteger, optionalText, text } from './row.ts';

export type BankAccountStatus = 'active' | 'needs_reverify' | 'removed';

export type BankAccount = {
  readonly id: string;
  readonly companyId: string;
  /** The registry key of the gateway that speaks to it. */
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  /** The OAuth client id and secret, sealed. Never decrypted in this file. */
  readonly credentials: Sealed;
  /** Safe to render. The whole client id is inside `credentials`. */
  readonly clientIdLast6: string | null;
  /** The full account number, sealed. */
  readonly accountNumber: Sealed;
  /** Safe to render, and the fourth column of the per-company unique key. */
  readonly accountLast4: string;
  readonly accountType: string | null;
  readonly holderId: string | null;
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
  readonly credentials: Sealed;
  readonly clientIdLast6: string | null;
  readonly accountNumber: Sealed;
  readonly accountLast4: string;
  readonly accountType: string | null;
  readonly holderId: string | null;
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

const COLUMNS = `id, company_id, bank, environment,
                 creds_ct, creds_iv, creds_key_v, client_id_last6,
                 account_ct, account_iv, account_last4, account_type, holder_id,
                 verified_at, creds_expire_at, status, created_at`;

/**
 * Both sealed values are read back with the same key version, because the
 * schema carries one `creds_key_v` for the row rather than one per envelope.
 * That is only sound while a row's two seals are written together — which they
 * are, in the single INSERT below. Re-sealing one without the other would need
 * a second version column first.
 */
export class D1BankAccountRepository implements BankAccountRepository {
  constructor(private readonly db: D1Database) {}

  async findById(id: string): Promise<BankAccount | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM bank_accounts WHERE id = ?`)
      .bind(id)
      .first<D1Row>();
    return row === null ? null : toBankAccount(row);
  }

  async insert(input: NewBankAccount): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    try {
      const row = await this.db
        .prepare(
          `INSERT INTO bank_accounts
               (id, company_id, bank, environment,
                creds_ct, creds_iv, creds_key_v, client_id_last6,
                account_ct, account_iv, account_last4, account_type, holder_id,
                creds_expire_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING ${COLUMNS}`,
        )
        .bind(
          input.id,
          input.companyId,
          input.bank,
          input.environment,
          input.credentials.ciphertext,
          input.credentials.iv,
          input.credentials.keyVersion,
          input.clientIdLast6,
          input.accountNumber.ciphertext,
          input.accountNumber.iv,
          input.accountLast4,
          input.accountType,
          input.holderId,
          input.credsExpireAt,
          input.createdAt,
        )
        .first<D1Row>();

      if (row === null) throw new AppError('internal', 'bank account insert returned no row');
      return ok(toBankAccount(row));
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
    return page.results.map(toBankAccount);
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
    return row === null ? null : toBankAccount(row);
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

  private async writeAndReturn(
    sql: string,
    args: readonly unknown[],
  ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    const row = await this.db
      .prepare(sql)
      .bind(...args)
      .first<D1Row>();
    return row === null ? err('not_found') : ok(toBankAccount(row));
  }
}

export function toBankAccount(row: D1Row): BankAccount {
  const keyVersion = integer(row, 'creds_key_v');

  return {
    id: text(row, 'id'),
    companyId: text(row, 'company_id'),
    bank: text(row, 'bank'),
    environment: toEnvironment(text(row, 'environment')),
    credentials: {
      ciphertext: bytes(row, 'creds_ct'),
      iv: bytes(row, 'creds_iv'),
      keyVersion,
    },
    clientIdLast6: optionalText(row, 'client_id_last6'),
    accountNumber: {
      ciphertext: bytes(row, 'account_ct'),
      iv: bytes(row, 'account_iv'),
      keyVersion,
    },
    accountLast4: text(row, 'account_last4'),
    accountType: optionalText(row, 'account_type'),
    holderId: optionalText(row, 'holder_id'),
    verifiedAt: optionalInteger(row, 'verified_at'),
    credsExpireAt: optionalInteger(row, 'creds_expire_at'),
    status: toStatus(text(row, 'status')),
    createdAt: integer(row, 'created_at'),
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
