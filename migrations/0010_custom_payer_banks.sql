-- Payer banks that Sudeban does not list, and the real target each one routes to.
--
-- A customer can pay from a wallet whose brand is not a bank in Sudeban's table
-- — Ubii is the first — and the counter has to offer that brand by name, because
-- that is the name on the customer's receipt. The bank we ask, though, is a real
-- one: an Ubii pago móvil lands in Venezolano de Crédito (0104) against a fixed
-- phone of ours, so the question that travels to the bank is BVC's and the row
-- of record is the customer's.
--
-- Two facts, therefore, and the row keeps both:
--
--   * `validations.source_bank_id` holds the code the cashier picked ('ubii'),
--     so every listing, receipt and breakdown names the brand the customer paid
--     from, and `payer_phone` holds the number they read out.
--   * `validations.metadata` holds what was actually asked — the `realTarget`:
--     the Sudeban code and the phone the search carried. Without it a support
--     call about an Ubii payment has no way back to the movement at BVC.
--
-- `code` is a slug, never four digits. That is what makes the two catalogues
-- impossible to confuse: a four-digit code is Sudeban's and is resolved from
-- `src/domain/sudeban.ts`, anything else is one of these rows. A CHECK would
-- have to spell a regex SQLite cannot; the domain refuses the shape on the way
-- in (`isCustomPayerBankCode`) and the distinction survives either way, because
-- a four-digit slug would simply never be reached by the lookup.
--
-- `target_phone` is nullable on purpose: a custom bank may only need its
-- Sudeban code rewritten, in which case the phone the cashier typed is the
-- phone that travels.
--
-- Additive: a new table and a new nullable column. Nothing is dropped, retyped
-- or deleted, so this is not a breaking migration.

CREATE TABLE custom_payer_banks (
  code           TEXT PRIMARY KEY,
  -- What the cashier reads in the picker and what every listing prints.
  name           TEXT NOT NULL,
  -- The Sudeban code the bank is actually asked with. Four digits.
  target_bank_id TEXT NOT NULL,
  -- The phone the search carries, E.164. NULL means "send the one that was typed".
  target_phone   TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

-- The picker only ever offers the active ones, and it asks for them by status.
CREATE INDEX ix_custom_payer_banks_status ON custom_payer_banks (status, name);

-- ── validations.metadata ────────────────────────────────────────────────────
-- JSON, nullable, and null on every row that exists: nothing but a custom payer
-- bank writes it today. It is a column and not a table because it is one small
-- object per row read only beside the row itself — and it is TEXT, not BLOB,
-- for the reason every other column here is (§6).
ALTER TABLE validations ADD COLUMN metadata TEXT;

-- ── Ubii ────────────────────────────────────────────────────────────────────
-- The first custom bank, and the reason the table exists. Both values are
-- editable from the admin panel afterwards; this is the row's birth, not its
-- definition.
INSERT INTO custom_payer_banks (code, name, target_bank_id, target_phone, status, created_at, updated_at)
VALUES ('ubii', 'Ubii', '0104', '+584142698301', 'active', '2026-08-25T00:00:00Z', '2026-08-25T00:00:00Z');
