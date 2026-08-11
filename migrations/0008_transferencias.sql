-- Transferencias beside pago móvil: what kind a validation was, how it was
-- found, and which accounts a connection receives them in.
--
-- Banesco answers the two with two different searches, and neither shape works
-- for the other (probed field by field against QA on 2026-08-11):
--
--   pago móvil     reference tail + phone + payer's bank + date
--   transferencia  reference tail + the merchant's own receiving account, and
--                  **no date** — sending one turns a movement the bank had just
--                  returned into `70001 · sin resultados`
--
-- Three things follow.
--
-- ── validations.kind ────────────────────────────────────────────────────────
-- Which of the two a row was. It is not derivable after the fact: a
-- transferencia carries no payer phone, and "phone is null" would also match
-- every transferencia the pre-0007 schema allowed. The column is explicit and
-- CHECKed, so a third kind is a migration rather than a typo.
--
-- ── validations.search_mode gains a value ───────────────────────────────────
-- 'reference_tail_and_account' is how a transferencia is found. SQLite cannot
-- alter a CHECK constraint in place, so this is the standard table rebuild —
-- create, copy by name, drop, rename, recreate the indexes — the same shape
-- migration 0005 used. `payer_phone` relaxes to nullable in the same rebuild,
-- because a transferencia genuinely has none and a sentinel would mean every
-- reader had to know which blank meant "no phone".
--
-- Rows are **copied, not dropped**: the validations that exist are confirmed
-- payments and all of them are pago móvil, which is exactly the default.
--
-- ── bank_accounts.receiving_accounts ────────────────────────────────────────
-- The full 20-digit accounts the merchant receives transferencias in, as a JSON
-- array of strings.
--
-- They cannot come from the bank, and that is the whole reason this column
-- exists. Consulta de Cuentas reports accounts **masked**
-- (`0134************5306`), the confirmation search refuses a masked account
-- with a 400, and the twelve hidden digits cannot be reconstructed. In QA the
-- two credentials are issued under different RIFs, so the accounts Consulta
-- lists are not even the ones Confirmación reports movements on. The merchant
-- therefore completes the numbers once, at the alta, with the bank's masked list
-- offered beside the field as a reminder of what to complete.
--
-- An empty array means this connection cannot validate transferencias, and the
-- counter says so rather than offering a form that could only fail.

ALTER TABLE bank_accounts ADD COLUMN receiving_accounts TEXT NOT NULL DEFAULT '[]';

-- ── validations, rebuilt ────────────────────────────────────────────────────
CREATE TABLE validations_new (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  cashier_id       TEXT NOT NULL REFERENCES users(id),
  bank_account_id  TEXT NOT NULL REFERENCES bank_accounts(id),
  bank             TEXT NOT NULL,

  -- New. Every row that exists is a pago móvil, which is the default.
  kind             TEXT NOT NULL DEFAULT 'pago_movil'
                     CHECK (kind IN ('pago_movil', 'transferencia')),

  is_sandbox       INTEGER NOT NULL DEFAULT 0 CHECK (is_sandbox IN (0, 1)),
  control_code     TEXT NOT NULL,

  reference        TEXT NOT NULL,
  reference_key    TEXT NOT NULL,

  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  currency         TEXT NOT NULL DEFAULT 'BS',
  -- Nullable again: a transferencia has no payer phone.
  payer_phone      TEXT,
  source_bank_id   TEXT NOT NULL,

  trn_at           TEXT NOT NULL,
  latency_ms       INTEGER,
  search_mode      TEXT CHECK (search_mode IN (
                     'exact_reference',
                     'reference_tail_and_phone',
                     'reference_tail_and_account'
                   )),

  idempotency_key  TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

-- Named on both sides, and `kind` is left to its default for every copied row.
INSERT INTO validations_new
  (id, company_id, cashier_id, bank_account_id, bank, is_sandbox, control_code,
   reference, reference_key, amount_cents, currency, payer_phone, source_bank_id,
   trn_at, latency_ms, search_mode, idempotency_key, created_at)
SELECT
   id, company_id, cashier_id, bank_account_id, bank, is_sandbox, control_code,
   reference, reference_key, amount_cents, currency, payer_phone, source_bank_id,
   trn_at, latency_ms, search_mode, idempotency_key, created_at
FROM validations;

DROP TABLE validations;
ALTER TABLE validations_new RENAME TO validations;

-- One payment can only be charged once. This index is the whole anti-double-
-- charge mechanism: two cashiers racing the same payment, one INSERT wins.
CREATE UNIQUE INDEX ux_validations_payment ON validations (bank_account_id, reference_key);
-- The control code is what a customer reads back, so it must be unambiguous
-- inside the company that issued it.
CREATE UNIQUE INDEX ux_validations_control ON validations (company_id, control_code);
-- Retrying the same POST returns the same validation and the same control code.
CREATE UNIQUE INDEX ux_validations_idempotency ON validations (idempotency_key);

CREATE INDEX ix_validations_company ON validations (company_id, created_at DESC);
CREATE INDEX ix_validations_sandbox ON validations (company_id, is_sandbox, created_at DESC);
CREATE INDEX ix_validations_cashier ON validations (cashier_id, created_at DESC);
