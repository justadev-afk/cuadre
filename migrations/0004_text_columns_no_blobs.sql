-- Get every BLOB out of the database, and store timestamps as ISO-8601 UTC.
--
-- Two motivations, both the maintainer's call:
--
--  1. BLOB columns are unreadable in the IDE/D1 consoles the team uses to
--     inspect data — a row comes back as an array of byte integers and some
--     tools choke on it entirely. Nothing here needs to be a BLOB.
--  2. Timestamps were epoch-seconds INTEGER (§6). They still are *inside* the
--     app — the domain compares and orders them as numbers — but the columns now
--     store ISO-8601 UTC (`2026-08-07T18:42:12Z`) so a human, an IDE, or a raw
--     query reads a real datetime. The repositories convert at the seam
--     (`epochToIso`/`isoToEpoch` in `clock.ts`); the domain never sees a string.
--     ISO-8601 UTC sorts lexicographically in the same order it sorts
--     chronologically, so every `created_at DESC` index keeps working as text.
--
-- The two sealed values change shape:
--  - The full account number is **no longer encrypted** — it is not sensitive
--    enough to seal (it is the merchant's own receiving account, which they hand
--    out to get paid). It moves to a plain `account_number` TEXT column, and its
--    envelope columns (`account_ct`/`account_iv`/`account_key_v`) are dropped.
--  - The OAuth client secret **stays encrypted** (it is a password) but its
--    ciphertext and IV are stored **base64 TEXT**, not BLOB.
--
-- This overrides the "timestamps are epoch seconds, never TEXT" note in 0001 and
-- the "nothing readable at rest / account number sealed" note in §6 — both
-- updated in the same change (CLAUDE.md).
--
-- The bank tables are wiped (every account here predates this change and would
-- be left mis-shaped), consistent with 0003; the other tables keep their rows
-- and convert their timestamps in place. `validations` is empty in production
-- and holds no confirmed history to lose.

-- ── bank_account_credentials: rebuilt with TEXT columns ─────────────────────
-- Dropped and recreated: it is a leaf table (nothing references it) and every
-- row is wiped, so a clean CREATE is simpler than column-by-column surgery.
DROP TABLE bank_account_credentials;

-- ── validations: wiped, timestamps → TEXT ISO ───────────────────────────────
-- Emptied first (it foreign-keys bank_accounts, which is about to be emptied
-- too). `created_at` carries three ordering indexes, and SQLite refuses to drop
-- an indexed column, so those come off and go back on around the retype.
DELETE FROM validations;
DROP INDEX ix_validations_company;
DROP INDEX ix_validations_sandbox;
DROP INDEX ix_validations_cashier;
ALTER TABLE validations DROP COLUMN created_at;
ALTER TABLE validations ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';
ALTER TABLE validations DROP COLUMN trn_at;
ALTER TABLE validations ADD COLUMN trn_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';
CREATE INDEX ix_validations_company ON validations (company_id, created_at DESC);
CREATE INDEX ix_validations_sandbox ON validations (company_id, is_sandbox, created_at DESC);
CREATE INDEX ix_validations_cashier ON validations (cashier_id, created_at DESC);

-- ── bank_accounts: wiped, account number in the clear, timestamps → TEXT ─────
DELETE FROM bank_accounts;
-- The account envelope is gone: the number is plain text now.
ALTER TABLE bank_accounts DROP COLUMN account_ct;
ALTER TABLE bank_accounts DROP COLUMN account_iv;
ALTER TABLE bank_accounts DROP COLUMN account_key_v;
ALTER TABLE bank_accounts ADD COLUMN account_number TEXT NOT NULL DEFAULT '';
-- Timestamps → TEXT ISO (table is empty, so a straight retype).
ALTER TABLE bank_accounts DROP COLUMN verified_at;
ALTER TABLE bank_accounts ADD COLUMN verified_at TEXT;
ALTER TABLE bank_accounts DROP COLUMN creds_expire_at;
ALTER TABLE bank_accounts ADD COLUMN creds_expire_at TEXT;
ALTER TABLE bank_accounts DROP COLUMN created_at;
ALTER TABLE bank_accounts ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';

-- Recreated with base64 TEXT ciphertext and an ISO created_at.
CREATE TABLE bank_account_credentials (
  id               TEXT PRIMARY KEY,
  bank_account_id  TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  cred_key         TEXT NOT NULL,
  usage            TEXT NOT NULL CHECK (usage IN ('operate', 'discover')),
  client_id_last6  TEXT,
  -- The `{clientId, clientSecret}` pair, AES-GCM sealed then base64-encoded.
  creds_ct         TEXT NOT NULL,
  creds_iv         TEXT NOT NULL,
  creds_key_v      INTEGER NOT NULL,
  created_at       TEXT NOT NULL,

  UNIQUE (bank_account_id, cred_key)
);
CREATE INDEX ix_bank_account_credentials_account
  ON bank_account_credentials (bank_account_id);

-- ── companies: created_at → TEXT ISO (rows kept) ────────────────────────────
ALTER TABLE companies RENAME COLUMN created_at TO created_at_epoch;
ALTER TABLE companies ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';
UPDATE companies SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', created_at_epoch, 'unixepoch');
ALTER TABLE companies DROP COLUMN created_at_epoch;

-- ── users: created_at + last_login_at → TEXT ISO (rows kept) ─────────────────
ALTER TABLE users RENAME COLUMN created_at TO created_at_epoch;
ALTER TABLE users ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';
UPDATE users SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', created_at_epoch, 'unixepoch');
ALTER TABLE users DROP COLUMN created_at_epoch;
ALTER TABLE users RENAME COLUMN last_login_at TO last_login_at_epoch;
ALTER TABLE users ADD COLUMN last_login_at TEXT;
UPDATE users SET last_login_at =
  CASE WHEN last_login_at_epoch IS NULL THEN NULL
       ELSE strftime('%Y-%m-%dT%H:%M:%SZ', last_login_at_epoch, 'unixepoch') END;
ALTER TABLE users DROP COLUMN last_login_at_epoch;

-- ── password_resets: created_at + expires_at + used_at → TEXT ISO (rows kept) ─
-- `created_at` carries an ordering index; drop it around the retype.
DROP INDEX ix_password_resets_user;
ALTER TABLE password_resets RENAME COLUMN created_at TO created_at_epoch;
ALTER TABLE password_resets ADD COLUMN created_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';
UPDATE password_resets SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', created_at_epoch, 'unixepoch');
ALTER TABLE password_resets DROP COLUMN created_at_epoch;
ALTER TABLE password_resets RENAME COLUMN expires_at TO expires_at_epoch;
ALTER TABLE password_resets ADD COLUMN expires_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00Z';
UPDATE password_resets SET expires_at = strftime('%Y-%m-%dT%H:%M:%SZ', expires_at_epoch, 'unixepoch');
ALTER TABLE password_resets DROP COLUMN expires_at_epoch;
ALTER TABLE password_resets RENAME COLUMN used_at TO used_at_epoch;
ALTER TABLE password_resets ADD COLUMN used_at TEXT;
UPDATE password_resets SET used_at =
  CASE WHEN used_at_epoch IS NULL THEN NULL
       ELSE strftime('%Y-%m-%dT%H:%M:%SZ', used_at_epoch, 'unixepoch') END;
ALTER TABLE password_resets DROP COLUMN used_at_epoch;
CREATE INDEX ix_password_resets_user ON password_resets (user_id, created_at DESC);
