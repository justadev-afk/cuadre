-- Cuadre — initial schema.
--
-- Forward-only and additive. A destructive migration ships alone, after a
-- backup, never alongside feature work.
--
-- Money is INTEGER cents everywhere. The bank answers `amount` as a decimal
-- (19,2) and we compare in cents, so no float ever reaches a comparison that
-- decides whether a payment is approved.
--
-- Timestamps are epoch **seconds** INTEGER, never TEXT: they are compared and
-- ordered far more often than they are displayed.

-- ── companies ─────────────────────────────────────────────────────────────
-- `id` is the slug — the value a cashier types at the counter, not a random
-- uuid behind one. Collapsing the two means the code on the login screen is
-- the same string that appears in every foreign key, so there is no second
-- identifier to keep in step and no lookup between the two.
--
-- It is therefore **immutable once created**. A company may be renamed freely
-- (`name`); its slug never changes, because changing it would rewrite every
-- validation's ownership. Lowercase ASCII kebab, enforced in the domain.
CREATE TABLE companies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  rif         TEXT NOT NULL UNIQUE,
  industry    TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at  INTEGER NOT NULL
);

-- ── users ─────────────────────────────────────────────────────────────────
-- Roles in one table because they differ by which credential identifies them,
-- not by what they are:
--
--   admin       — platform team. `company_id` IS NULL. Email + password.
--   company     — the merchant's own administrator. Email + password.
--   supervisor  — dropped in 0002. See that migration.
--   cashier     — (company_id, username) + PIN. Never an email: a cashier's
--                 PIN is reset by their company, so they need no mail channel
--                 and we carry no address for them.
--
-- The cashier login tuple is `(company_id, username)`. Since `company_id` is
-- the slug, that tuple is literally what is typed on the login screen:
-- `la-espiga` + `maria.r`.
CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  company_id     TEXT REFERENCES companies(id),
  role           TEXT NOT NULL CHECK (role IN ('admin', 'company', 'supervisor', 'cashier')),
  name           TEXT NOT NULL,
  email          TEXT,
  username       TEXT,
  -- PBKDF2-SHA256, 210k iterations. Same function for passwords and PINs: a
  -- 4-digit PIN is weak on its own, which is why it is rate limited (5 per
  -- user per hour) rather than hashed differently.
  password_hash  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at  INTEGER,
  created_at     INTEGER NOT NULL,

  -- A cashier has a username and no email; everyone else the reverse.
  CHECK ((role = 'cashier') = (username IS NOT NULL)),
  CHECK ((role = 'cashier') = (email IS NULL)),
  -- Only a platform admin is company-less.
  CHECK ((role = 'admin') = (company_id IS NULL))
);

-- Partial uniques: NULL columns must not collide with each other.
CREATE UNIQUE INDEX ux_users_email ON users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX ux_users_login ON users (company_id, username) WHERE username IS NOT NULL;
CREATE INDEX ix_users_company ON users (company_id, role);

-- ── bank_accounts ─────────────────────────────────────────────────────────
-- `bank` is the registry key of the gateway adapter that speaks to it
-- ('banesco' today). It is a plain string and not a CHECK constraint on
-- purpose: adding a bank must be a new adapter plus a row, never a migration.
--
-- Nothing readable is stored. The client secret and the full 20-digit account
-- number are AES-GCM sealed; what survives in the clear is the last 4 of the
-- account and the last 6 of the client id, which is all the UI ever shows.
CREATE TABLE bank_accounts (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  bank             TEXT NOT NULL,
  environment      TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),

  creds_ct         BLOB NOT NULL,
  creds_iv         BLOB NOT NULL,
  creds_key_v      INTEGER NOT NULL,
  client_id_last6  TEXT,

  account_ct       BLOB NOT NULL,
  account_iv       BLOB NOT NULL,
  account_last4    TEXT NOT NULL,
  account_type     TEXT,
  holder_id        TEXT,

  verified_at      INTEGER,
  -- QA credentials expire. We warn 7 days out and mark the account
  -- 'needs_reverify' rather than deleting it: the validations that point at it
  -- must keep resolving.
  creds_expire_at  INTEGER,
  status           TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'needs_reverify', 'removed')),
  created_at       INTEGER NOT NULL,

  UNIQUE (company_id, bank, environment, account_last4)
);

CREATE INDEX ix_bank_accounts_company ON bank_accounts (company_id, status);

-- ── validations ───────────────────────────────────────────────────────────
-- **Only confirmed payments live here. A row IS a validated payment.**
-- An attempt that found nothing is not an accounting fact, it is a retry: it
-- goes to Workers Logs and Analytics Engine and nowhere else. That is what
-- lets the company panel skip a status filter entirely, and what lets the
-- unique index below mean what it says.
CREATE TABLE validations (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES companies(id),
  cashier_id       TEXT NOT NULL REFERENCES users(id),
  bank_account_id  TEXT NOT NULL REFERENCES bank_accounts(id),
  bank             TEXT NOT NULL,

  -- Copied from the account, never joined. If the sandbox account is deleted
  -- tomorrow, the history still knows which rows were tests — and this is the
  -- column the filter and the row badge read.
  is_sandbox       INTEGER NOT NULL DEFAULT 0 CHECK (is_sandbox IN (0, 1)),

  -- Six digits the cashier writes on the receipt or reads out over the phone.
  -- Not a secret: a short handle for finding one validation without reading
  -- eleven digits of reference back.
  control_code     TEXT NOT NULL,

  reference        TEXT NOT NULL,
  amount_cents     INTEGER NOT NULL CHECK (amount_cents > 0),
  currency         TEXT NOT NULL DEFAULT 'BS',
  payer_phone      TEXT NOT NULL,
  source_bank_id   TEXT NOT NULL,

  trn_at           INTEGER NOT NULL,
  latency_ms       INTEGER,
  search_mode      TEXT CHECK (search_mode IN ('exact_reference', 'reference_tail_and_phone')),

  idempotency_key  TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

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

-- ── password_resets ───────────────────────────────────────────────────────
-- The token itself is never stored, only its SHA-256. A database dump is
-- therefore not a set of live reset links.
CREATE TABLE password_resets (
  token_hash    TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  expires_at    INTEGER NOT NULL,
  used_at       INTEGER,
  requested_ip  TEXT,
  created_at    INTEGER NOT NULL
);

CREATE INDEX ix_password_resets_user ON password_resets (user_id, created_at DESC);
