-- Move the OAuth credentials off `bank_accounts` into their own table.
--
-- 0001 sealed every credential pair a bank needed as ONE opaque blob on the
-- account row (`creds_ct`/`creds_iv`), sharing a single `creds_key_v` with the
-- account number's envelope. That was small but it hid structure: how many
-- pairs an account holds, which one the counter runs on and which only lists
-- accounts, and the six-digit tail of each client id were all buried inside
-- ciphertext, unreadable without the key. Debugging a bad affiliation meant
-- decrypting to see anything at all.
--
-- Now each credential pair is its own row. The shape is visible in the clear —
-- `cred_key`, `usage`, `client_id_last6` — and only the pair itself stays
-- sealed. A bank with one pair has one row; Banesco has two (Confirmación =
-- operate, Consulta = discover). Each row carries its own key version, so a
-- rotated secret re-seals one row and never touches the account number's
-- envelope, which now stands alone on `bank_accounts` under `account_key_v`.
--
-- The invariant this refactor buys is: **no account without credentials.** They
-- are written together in one batch (see `bank-account.repository.insert`) and
-- an account can only exist because its credentials do. The old single blob
-- cannot be split into per-pair rows losslessly — the pairs' `usage` was never
-- stored and the key version was shared — so every existing account would land
-- on the far side of this migration with its credentials dropped and no way to
-- validate. Rather than leave those zombie rows, this migration **deletes every
-- bank account** (and the validation history that points at it): the merchant
-- re-adds the bank through the wizard, which now mints the account and its
-- credentials atomically. Production was reset for exactly this change, so there
-- is nothing to lose there; locally `scripts/seed-demo.ts` rebuilds the demo
-- account and its Confirmación pair.
--
-- `validations.bank_account_id` is a NOT NULL foreign key into `bank_accounts`,
-- and SQLite enforces it during a D1 migration (its transaction makes
-- `PRAGMA foreign_keys = OFF` a no-op), so the history is cleared first, before
-- the accounts it references. Nothing references `validations`, so it goes
-- cleanly.

-- Wipe every account and the money history pointing at it, foreign key first.
-- After this migration an account carries no credentials until the wizard adds
-- them, and an account with none cannot validate — so none are left behind.
DELETE FROM validations;
DELETE FROM bank_accounts;

-- The account number keeps its envelope; the key version it shared with the
-- now-departed credentials is renamed to stand on its own.
ALTER TABLE bank_accounts DROP COLUMN creds_ct;
ALTER TABLE bank_accounts DROP COLUMN creds_iv;
ALTER TABLE bank_accounts RENAME COLUMN creds_key_v TO account_key_v;

-- One row per OAuth credential pair the account holds.
--
--  - `cred_key` is the bank's own credential-group key (Banesco: 'confirmation',
--    'consulta'); UNIQUE per account so a pair is replaced, never duplicated.
--  - `usage` is what the pair is FOR — 'operate' finds a payment at the counter,
--    'discover' lists the merchant's accounts at onboarding. A single-pair bank
--    has one row and the counter uses it whatever its usage says.
--  - `client_id_last6` is the maskable tail the panel shows.
--  - `creds_ct`/`creds_iv`/`creds_key_v` seal the `{clientId, clientSecret}`
--    pair, each row on its own key version.
--
-- ON DELETE CASCADE is defence in depth: `bank_accounts` is soft-deleted (status
-- 'removed'), never hard-deleted, so this never fires in normal operation.
CREATE TABLE bank_account_credentials (
  id               TEXT PRIMARY KEY,
  bank_account_id  TEXT NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  cred_key         TEXT NOT NULL,
  usage            TEXT NOT NULL CHECK (usage IN ('operate', 'discover')),
  client_id_last6  TEXT,
  creds_ct         BLOB NOT NULL,
  creds_iv         BLOB NOT NULL,
  creds_key_v      INTEGER NOT NULL,
  created_at       INTEGER NOT NULL,

  UNIQUE (bank_account_id, cred_key)
);

CREATE INDEX ix_bank_account_credentials_account
  ON bank_account_credentials (bank_account_id);
