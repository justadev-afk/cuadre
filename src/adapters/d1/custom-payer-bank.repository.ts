/**
 * The custom payer banks — the brands a customer can pay from that Sudeban does
 * not list, and the real bank each one routes to.
 *
 * A tiny, platform-wide table: there is one row today and there will not be
 * many. It is read on the counter's path (only when the code the cashier picked
 * is not a Sudeban one — a four-digit code can never be a row here, so the
 * common charge does not pay for this file at all) and written from the admin
 * panel.
 *
 * Nothing is hard-deleted. `validations.source_bank_id` points at a code here
 * and has to keep naming a payment years later, so `status` goes both ways and
 * there is no delete — the same rule a user row lives under (§6).
 */
import type { CustomPayerBank, CustomPayerBankStatus } from '../../domain/payer-bank.ts';
import { epochToIso } from '../../shared/clock.ts';
import { type D1Row, optionalText, text } from './row.ts';

export type NewCustomPayerBank = {
  readonly code: string;
  readonly name: string;
  readonly targetBankId: string;
  readonly targetPhone: string | null;
  readonly status: CustomPayerBankStatus;
  readonly at: number;
};

/** Everything but the code, which is the primary key and therefore immutable. */
export type CustomPayerBankEdit = Omit<NewCustomPayerBank, 'code'>;

export interface CustomPayerBankRepository {
  /** Every row, active first then disabled, by name. The admin's table. */
  list(): Promise<readonly CustomPayerBank[]>;
  /** Only what a counter may offer. The picker's half. */
  listActive(): Promise<readonly CustomPayerBank[]>;
  find(code: string): Promise<CustomPayerBank | null>;
  /**
   * Creates the row, or refuses when the code is taken. Creating and editing
   * are two statements rather than an upsert: "this code already exists" is a
   * sentence the admin needs to read, and an upsert would silently overwrite
   * the brand a payment history already names.
   */
  insert(input: NewCustomPayerBank): Promise<'inserted' | 'code_taken'>;
  update(code: string, input: CustomPayerBankEdit): Promise<'updated' | 'not_found'>;
}

const COLUMNS = 'code, name, target_bank_id, target_phone, status';

export class D1CustomPayerBankRepository implements CustomPayerBankRepository {
  constructor(private readonly db: D1Database) {}

  async list(): Promise<readonly CustomPayerBank[]> {
    const result = await this.db
      .prepare(
        `SELECT ${COLUMNS} FROM custom_payer_banks
          ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, name`,
      )
      .all<D1Row>();
    return result.results.map(toCustomPayerBank);
  }

  async listActive(): Promise<readonly CustomPayerBank[]> {
    const result = await this.db
      .prepare(`SELECT ${COLUMNS} FROM custom_payer_banks WHERE status = 'active' ORDER BY name`)
      .all<D1Row>();
    return result.results.map(toCustomPayerBank);
  }

  async find(code: string): Promise<CustomPayerBank | null> {
    const row = await this.db
      .prepare(`SELECT ${COLUMNS} FROM custom_payer_banks WHERE code = ?`)
      .bind(code)
      .first<D1Row>();
    return row === null ? null : toCustomPayerBank(row);
  }

  async insert(input: NewCustomPayerBank): Promise<'inserted' | 'code_taken'> {
    // The primary key is the arbiter, not a SELECT before the INSERT: two
    // admins filing the same brand at once both read "free" and both write.
    const written = await this.db
      .prepare(
        `INSERT INTO custom_payer_banks
             (code, name, target_bank_id, target_phone, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (code) DO NOTHING
           RETURNING code`,
      )
      .bind(
        input.code,
        input.name,
        input.targetBankId,
        input.targetPhone,
        input.status,
        epochToIso(input.at),
        epochToIso(input.at),
      )
      .first<D1Row>();
    return written === null ? 'code_taken' : 'inserted';
  }

  async update(code: string, input: CustomPayerBankEdit): Promise<'updated' | 'not_found'> {
    const written = await this.db
      .prepare(
        `UPDATE custom_payer_banks
            SET name = ?, target_bank_id = ?, target_phone = ?, status = ?, updated_at = ?
          WHERE code = ?
          RETURNING code`,
      )
      .bind(
        input.name,
        input.targetBankId,
        input.targetPhone,
        input.status,
        epochToIso(input.at),
        code,
      )
      .first<D1Row>();
    return written === null ? 'not_found' : 'updated';
  }
}

/**
 * Row → domain. `status` is read against the union rather than cast: the CHECK
 * constraint is the database's promise and this is the one place it is worth
 * not taking on trust, because an unknown value would put a brand in the picker
 * that nobody enabled.
 */
function toCustomPayerBank(row: D1Row): CustomPayerBank {
  const status = text(row, 'status');
  return {
    code: text(row, 'code'),
    name: text(row, 'name'),
    targetBankId: text(row, 'target_bank_id'),
    targetPhone: optionalText(row, 'target_phone'),
    status: status === 'active' ? 'active' : 'disabled',
  };
}
