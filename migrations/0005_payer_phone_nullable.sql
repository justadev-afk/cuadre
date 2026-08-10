-- `validations.payer_phone` becomes nullable: a transferencia has no payer phone.
--
-- Until now every charge was a pago móvil, which is *made from* a phone, so the
-- column could demand one. A transferencia carries none at all — the bank finds
-- it by reference alone (verified live against Banesco QA: ref 00000150496 → CR
-- Bs 525,08, no phone anywhere in the request) — and the honest record of that
-- payment is NULL, not an empty string standing in for one. A sentinel here
-- would mean every reader had to know which blank meant "none"; a NULL means it
-- in the column itself.
--
-- SQLite cannot relax a NOT NULL in place, and the DROP COLUMN / ADD COLUMN
-- shortcut 0004 used on empty tables would erase the phone of every payment
-- already charged. So this is the standard rebuild: a new table with the one
-- constraint relaxed, every row copied across by name, the indexes recreated.
-- Nothing is dropped, retyped or reordered in a way any query can see.
--
-- **Safe to apply before the code that writes a NULL**, which is the order it
-- ships in: the column merely *accepts* one now, and the running code, which
-- always writes a phone, cannot tell the difference.

CREATE TABLE validations_new (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  cashier_id       TEXT NOT NULL REFERENCES users(id),
  bank_account_id  TEXT NOT NULL REFERENCES bank_accounts(id),
  bank             TEXT NOT NULL,

  -- Copied from the account, never joined. If the sandbox account is deleted
  -- tomorrow, the history still knows which rows were tests.
  is_sandbox       INTEGER NOT NULL DEFAULT 0 CHECK (is_sandbox IN (0, 1)),

  -- Six digits the cashier writes on the receipt or reads out over the phone.
  control_code     TEXT NOT NULL,

  reference        TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  currency         TEXT NOT NULL DEFAULT 'BS',
  -- The one change in this migration. NULL is a transferencia.
  payer_phone      TEXT,
  source_bank_id   TEXT NOT NULL,

  trn_at           TEXT NOT NULL,
  latency_ms       INTEGER,
  search_mode      TEXT CHECK (search_mode IN ('exact_reference', 'reference_tail_and_phone')),

  idempotency_key  TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

-- Named on both sides: 0004 dropped and re-added two columns, so the physical
-- order of the old table is not the order it was declared in.
INSERT INTO validations_new
  (id, company_id, cashier_id, bank_account_id, bank, is_sandbox, control_code,
   reference, amount_cents, currency, payer_phone, source_bank_id, trn_at,
   latency_ms, search_mode, idempotency_key, created_at)
SELECT
   id, company_id, cashier_id, bank_account_id, bank, is_sandbox, control_code,
   reference, amount_cents, currency, payer_phone, source_bank_id, trn_at,
   latency_ms, search_mode, idempotency_key, created_at
FROM validations;

-- Nothing references `validations`, so it is a leaf and the swap needs no
-- foreign-key surgery. Its indexes go with it and are recreated below.
DROP TABLE validations;
ALTER TABLE validations_new RENAME TO validations;

-- One payment can only be charged once. This index is the whole anti-double-
-- charge mechanism: two cashiers racing the same reference, one INSERT wins.
CREATE UNIQUE INDEX ux_validations_payment ON validations (bank_account_id, reference);
-- The control code is what a customer reads back, so it must be unambiguous
-- inside the company that issued it.
CREATE UNIQUE INDEX ux_validations_control ON validations (company_id, control_code);
-- Retrying the same POST returns the same validation and the same control code.
CREATE UNIQUE INDEX ux_validations_idempotency ON validations (idempotency_key);

CREATE INDEX ix_validations_company ON validations (company_id, created_at DESC);
CREATE INDEX ix_validations_sandbox ON validations (company_id, is_sandbox, created_at DESC);
CREATE INDEX ix_validations_cashier ON validations (cashier_id, created_at DESC);
