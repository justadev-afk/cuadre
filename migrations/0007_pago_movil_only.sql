-- Pago móvil only: a merchant connects a **bank**, not an account.
--
-- Banesco reviewed the app on 2026-08-11 and asked for three things that all
-- land on this schema:
--
--  1. Validate pago móvil and nothing else. The payer's phone is required, so
--     `validations.payer_phone` goes back to NOT NULL (0005 relaxed it for
--     transferencias, which we no longer offer).
--  2. Drop the receiving account. A pago móvil is found by the last six digits
--     of the reference plus the payer's phone, their bank's code and the date —
--     the receiving account is not part of that question, and the Consulta de
--     Cuentas client we collected only ever existed to let a merchant pick one.
--     So `bank_accounts` loses `account_number`, `account_last4`, `account_type`
--     and `holder_id`, and gains an optional `label`: the merchant's own name
--     for the affiliation ("Caja principal"), which is what the counter's new
--     "banco receptor" dropdown shows beside the bank's name.
--  3. Ask the bank *before* deciding a payment is already charged. The counter
--     now types six digits, which are not an identifier, so the charge is keyed
--     on what the **bank** answers with. `validations.reference_key` therefore
--     stops being derived from `reference` in SQL and is supplied by the use
--     case (`paymentKey` in `src/domain/payment-match.ts`): the bank's
--     canonical reference, or — when the bank echoes back nothing more than the
--     six digits it was given — that tail paired with the day it happened.
--
-- `bank_account_credentials` goes entirely, and the credentials come back onto
-- the account as **one sealed JSON blob** (`creds_ct`/`creds_iv`/`creds_key_v`).
-- 0003 split them into a row per pair to make the shape visible — how many pairs
-- an account held, which one the counter ran on — and every one of those
-- questions has since answered itself: a bank holds whatever pairs its adapter
-- declares, and which one operates is `BankGateway.operateKey`, declared once in
-- the adapter. What is left is a map keyed by the bank's own credential-group
-- key, opaque to everything but that adapter, which is exactly what one sealed
-- JSON value is for. A join and a batch write disappear with it.
--
-- **Both bank tables and the whole validation history are dropped and rebuilt.**
-- Every existing account is a row shaped around an account number that no longer
-- has a column, and every validation points at one. The maintainer confirmed
-- there is nothing to keep on either side; a merchant re-connects their bank
-- through the (now single-step) wizard, and `scripts/seed-demo.ts` rebuilds the
-- demo affiliation locally.
--
-- Order matters: `validations` foreign-keys `bank_accounts`, and SQLite enforces
-- it inside D1's migration transaction (which makes `PRAGMA foreign_keys = OFF`
-- a no-op), so the history goes first.

DROP TABLE validations;
DROP TABLE bank_account_credentials;
DROP TABLE bank_accounts;


-- ── bank_accounts — an affiliation, not an account ──────────────────────────
-- `bank` stays plain TEXT with no CHECK: adding a bank is an adapter plus a
-- registry entry, never a migration.
CREATE TABLE bank_accounts (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  bank             TEXT NOT NULL,
  environment      TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),

  -- The merchant's own name for this connection, optional. Two affiliations of
  -- the same bank look identical without it, which is the whole reason the
  -- counter offers the field: "Banesco · Caja principal" vs "Banesco · Delivery".
  label            TEXT,

  -- The tail of the operate pair's client id. All the UI ever shows of it, and
  -- what tells two affiliations of one bank apart in the unique key below.
  client_id_last6  TEXT,

  -- Every credential pair this bank needs, as one JSON object keyed by the
  -- adapter's own credential-group key ({"confirmation": {clientId, clientSecret}}) —
  -- AES-GCM sealed, then base64 TEXT (no BLOBs, §6). Each bank stores whatever
  -- it needs in there and nothing outside its adapter reads the shape.
  -- `creds_key_v` records which master key sealed it, so a rotation re-seals
  -- rows rather than losing them.
  creds_ct         TEXT NOT NULL,
  creds_iv         TEXT NOT NULL,
  creds_key_v      INTEGER NOT NULL,

  verified_at      TEXT,
  -- QA credentials expire. We warn 7 days out and mark the account
  -- 'needs_reverify' rather than deleting it: the validations that point at it
  -- must keep resolving.
  creds_expire_at  TEXT,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'needs_reverify', 'removed')),
  created_at       TEXT NOT NULL,

  -- One connection per (bank, environment, OAuth client). A merchant with two
  -- Banesco affiliations connects both; connecting the same one twice is the
  -- misclick this refuses.
  UNIQUE (company_id, bank, environment, client_id_last6)
);

CREATE INDEX ix_bank_accounts_company ON bank_accounts (company_id, status);

-- ── validations — confirmed payments only ───────────────────────────────────
-- **A row here IS a payment the bank told us had landed.** An attempt that found
-- nothing is not an accounting fact, it is a retry: it goes to Workers Logs and
-- Analytics Engine and nowhere else.
CREATE TABLE validations (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  cashier_id       TEXT NOT NULL REFERENCES users(id),
  bank_account_id  TEXT NOT NULL REFERENCES bank_accounts(id),
  bank             TEXT NOT NULL,

  -- Copied from the account, never joined. If the sandbox connection is deleted
  -- tomorrow, the history still knows which rows were tests.
  is_sandbox       INTEGER NOT NULL DEFAULT 0 CHECK (is_sandbox IN (0, 1)),

  -- Six digits the cashier writes on the receipt or reads out over the phone.
  control_code     TEXT NOT NULL,

  -- The reference **as the bank reported it** — normally the full number, which
  -- is more than the cashier typed and is what the customer's receipt shows.
  reference        TEXT NOT NULL,
  -- What the payment is identified by; see `paymentKey`. NOT NULL, unlike 0006:
  -- there is no older build writing rows without it, because the table is new.
  reference_key    TEXT NOT NULL,

  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  currency         TEXT NOT NULL DEFAULT 'BS',
  -- Required again: every validation is a pago móvil, and a pago móvil is made
  -- from a phone.
  payer_phone      TEXT NOT NULL,
  source_bank_id   TEXT NOT NULL,

  trn_at           TEXT NOT NULL,
  latency_ms       INTEGER,
  search_mode      TEXT CHECK (search_mode IN ('exact_reference', 'reference_tail_and_phone')),

  idempotency_key  TEXT NOT NULL,
  created_at       TEXT NOT NULL
);

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
