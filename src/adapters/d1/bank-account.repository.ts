/**
 * The bank affiliations a company has connected, and the OAuth credentials each
 * one holds.
 *
 * An "account" here is a **connection to a bank**, not a bank account: since
 * migration 0007 there is no account number on the row at all. A pago móvil is
 * found by the payer's phone, their bank's code and the date, so the receiving
 * account was never part of the question — what a merchant connects is an
 * affiliation, named by an optional `label` of their own.
 *
 * The credentials are **one sealed JSON value** on the row: a map from the
 * bank's own credential-group key to that pair, whose shape is the adapter's
 * business and nobody else's. 0003 had split it into a row per pair to make the
 * structure visible; with the second Banesco client gone there is no structure
 * left to see, and a column is the simpler thing that is still true.
 *
 * This repository moves those sealed bytes and never holds the key. `CREDS_KEY`
 * is not a dependency here and must not become one: a row read out of this file
 * carries a `Sealed` envelope, and the only thing that can turn it back into a
 * client secret is `unseal`, called by the layer that has a reason to.
 *
 * Nothing is ever hard-deleted. `validations.bank_account_id` points here and
 * that history has to keep resolving years after a company changes banks, so
 * `remove` is a status change — which is why `status` has a 'removed' value at
 * all.
 */
import type { BankEnvironment, BankId } from '../../application/ports/bank-gateway.ts';
import { epochToIso } from '../../shared/clock.ts';
import { fromBase64, type Sealed, toBase64 } from '../../shared/crypto.ts';
import { err, ok, type Result } from '../../shared/result.ts';
import { isUniqueIndex, readConstraintFailure, type UniqueIndex } from './constraint-error.ts';
import {
  type D1Row,
  epochFromIso,
  integer,
  optionalEpochFromIso,
  optionalText,
  text,
} from './row.ts';

export type BankAccountStatus = 'active' | 'needs_reverify' | 'removed';

export type BankAccount = {
  readonly id: string;
  readonly companyId: string;
  /** The registry key of the gateway that speaks to it. */
  readonly bank: BankId;
  readonly environment: BankEnvironment;
  /** The merchant's own name for this connection. Optional, and never unique. */
  readonly label: string | null;
  /**
   * The full account numbers this connection receives transferencias in.
   *
   * Supplied by the merchant, never by the bank: Consulta de Cuentas reports
   * them masked and the payment search refuses a masked one (0008). Empty means
   * this connection validates pago móvil only, and the counter says so.
   */
  readonly receivingAccounts: readonly string[];
  /** Safe to render: the operate pair's tail. The whole id is inside the seal. */
  readonly clientIdLast6: string | null;
  /**
   * Every credential pair the bank needs, as one sealed JSON object. Never
   * decrypted in this file — see the note at the top.
   */
  readonly credentials: Sealed;
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
  readonly label: string | null;
  readonly receivingAccounts: readonly string[];
  readonly clientIdLast6: string | null;
  readonly credentials: Sealed;
  readonly credsExpireAt: number | null;
  /** The credentials authenticated a moment ago, so the row is born verified. */
  readonly verifiedAt: number;
  readonly createdAt: number;
};

export type BankAccountWriteFailure = 'account_already_linked' | 'unknown_company' | 'not_found';

export interface BankAccountRepository {
  insert(input: NewBankAccount): Promise<Result<BankAccount, BankAccountWriteFailure>>;
  findById(id: string): Promise<BankAccount | null>;
  listByCompany(companyId: string, includeRemoved?: boolean): Promise<readonly BankAccount[]>;
  /**
   * Every usable connection a company has, most-recently-verified first — what
   * the counter's "banco receptor" dropdown lists and what the use case resolves
   * the cashier's choice against.
   */
  listActiveForCompany(companyId: string): Promise<readonly BankAccount[]>;
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
  /** Replaces the connection's receiving accounts with the merchant's new set. */
  setReceivingAccounts(
    id: string,
    accounts: readonly string[],
  ): Promise<Result<BankAccount, BankAccountWriteFailure>>;
  /**
   * Replaces the credentials (re-stamping `verified_at` and clearing
   * `needs_reverify`) — never touching the bank or the environment, which are
   * the connection's identity.
   */
  replaceCredentials(
    id: string,
    credentials: Sealed,
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
    'bank_accounts.client_id_last6',
  ],
};

const COLUMNS = `id, company_id, bank, environment, label, receiving_accounts,
                 client_id_last6, creds_ct, creds_iv, creds_key_v,
                 verified_at, creds_expire_at, status, created_at`;

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
               (id, company_id, bank, environment, label, receiving_accounts,
                client_id_last6, creds_ct, creds_iv, creds_key_v,
                verified_at, creds_expire_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             RETURNING ${COLUMNS}`,
        )
        .bind(
          input.id,
          input.companyId,
          input.bank,
          input.environment,
          input.label,
          JSON.stringify([...input.receivingAccounts]),
          input.clientIdLast6,
          toBase64(input.credentials.ciphertext),
          toBase64(input.credentials.iv),
          input.credentials.keyVersion,
          epochToIso(input.verifiedAt),
          input.credsExpireAt === null ? null : epochToIso(input.credsExpireAt),
          epochToIso(input.createdAt),
        )
        .first<D1Row>();

      // A RETURNING insert that matched nothing cannot happen without a
      // constraint firing, which is the catch below.
      if (row === null) return err('not_found');
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
   * Both environments come back in one list: which one answers is the cashier's
   * pick in the "banco receptor" dropdown, not a decision taken for them here.
   */
  async listActiveForCompany(companyId: string): Promise<readonly BankAccount[]> {
    const page = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM bank_accounts
            WHERE company_id = ? AND status <> 'removed'
            ORDER BY (environment = 'production') DESC, (status = 'active') DESC,
                     verified_at DESC, created_at DESC`,
      )
      .bind(companyId)
      .all<D1Row>();
    return page.results.map(toBankAccount);
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
      [epochToIso(at), credsExpireAt === null ? null : epochToIso(credsExpireAt), id],
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

  setReceivingAccounts(
    id: string,
    accounts: readonly string[],
  ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    return this.writeAndReturn(
      `UPDATE bank_accounts SET receiving_accounts = ?
          WHERE id = ? AND status <> 'removed'
          RETURNING ${COLUMNS}`,
      [JSON.stringify([...accounts]), id],
    );
  }

  remove(id: string): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    return this.writeAndReturn(
      `UPDATE bank_accounts SET status = 'removed' WHERE id = ? RETURNING ${COLUMNS}`,
      [id],
    );
  }

  /**
   * The caller (change-bank-credentials) has already established the connection
   * is the merchant's and not removed. The `status <> 'removed'` guard is the
   * last line: if it matches nothing the row vanished under us, and that is
   * reported as not_found rather than written around.
   */
  replaceCredentials(
    id: string,
    credentials: Sealed,
    clientIdLast6: string | null,
    verifiedAt: number,
  ): Promise<Result<BankAccount, BankAccountWriteFailure>> {
    return this.writeAndReturn(
      `UPDATE bank_accounts
            SET creds_ct = ?, creds_iv = ?, creds_key_v = ?,
                client_id_last6 = ?, verified_at = ?, status = 'active'
          WHERE id = ? AND status <> 'removed'
          RETURNING ${COLUMNS}`,
      [
        toBase64(credentials.ciphertext),
        toBase64(credentials.iv),
        credentials.keyVersion,
        clientIdLast6,
        epochToIso(verifiedAt),
        id,
      ],
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
  return {
    id: text(row, 'id'),
    companyId: text(row, 'company_id'),
    bank: text(row, 'bank'),
    environment: toEnvironment(text(row, 'environment')),
    label: optionalText(row, 'label'),
    receivingAccounts: readAccounts(optionalText(row, 'receiving_accounts')),
    clientIdLast6: optionalText(row, 'client_id_last6'),
    credentials: {
      ciphertext: fromBase64(text(row, 'creds_ct')),
      iv: fromBase64(text(row, 'creds_iv')),
      keyVersion: integer(row, 'creds_key_v'),
    },
    verifiedAt: optionalEpochFromIso(row, 'verified_at'),
    credsExpireAt: optionalEpochFromIso(row, 'creds_expire_at'),
    status: toStatus(text(row, 'status')),
    createdAt: epochFromIso(row, 'created_at'),
  };
}

/**
 * The JSON array of receiving accounts, read defensively.
 *
 * A column that will not parse, or that holds anything but strings of digits, is
 * read as *no accounts* rather than as a crash: the consequence is a connection
 * that offers pago móvil only, which is a visible and recoverable state, where a
 * throw would take down every screen that lists banks.
 */
function readAccounts(raw: string | null): readonly string[] {
  if (raw === null || raw.trim() === '') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === 'string' && value !== '');
  } catch {
    return [];
  }
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
