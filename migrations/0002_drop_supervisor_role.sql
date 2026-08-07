-- Drop the `supervisor` role.
--
-- 0001 carried four roles, copied from the technical document. There are
-- three: **admin, company, cashier**. A supervisor tier — everything a company
-- user can see, but allowed to do less — is a permission matrix nobody asked
-- for. A merchant has one administrator and however many cashiers they employ.
--
-- Adding a tier back later is additive: one more value in the CHECK and one
-- more guard. Leaving an unused role in the schema is not free — it is a
-- branch every future authorisation check has to answer for.
--
-- SQLite cannot alter a CHECK constraint, so this is the standard table
-- rebuild: create, copy, drop, rename. It runs before any row exists, so the
-- copy is empty and the rebuild is free. Were there data, this migration
-- would ship alone and after a backup (CLAUDE.md §6).

PRAGMA foreign_keys = OFF;

CREATE TABLE users_new (
  id             TEXT PRIMARY KEY,
  company_id     TEXT REFERENCES companies(id),
  role           TEXT NOT NULL CHECK (role IN ('admin', 'company', 'cashier')),
  name           TEXT NOT NULL,
  email          TEXT,
  username       TEXT,
  password_hash  TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  last_login_at  INTEGER,
  created_at     INTEGER NOT NULL,

  CHECK ((role = 'cashier') = (username IS NOT NULL)),
  CHECK ((role = 'cashier') = (email IS NULL)),
  CHECK ((role = 'admin') = (company_id IS NULL))
);

-- Any existing supervisor becomes a company user: it is the role it was always
-- closest to, and it keeps the person's access rather than silently locking
-- them out. There are none today; this is here so the migration is correct if
-- it is ever replayed against a database that has some.
INSERT INTO users_new (
  id, company_id, role, name, email, username,
  password_hash, status, last_login_at, created_at
)
SELECT
  id, company_id,
  CASE WHEN role = 'supervisor' THEN 'company' ELSE role END,
  name, email, username,
  password_hash, status, last_login_at, created_at
FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

-- Indexes do not survive the rename; recreate them exactly as 0001 had them.
CREATE UNIQUE INDEX ux_users_email ON users (email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX ux_users_login ON users (company_id, username) WHERE username IS NOT NULL;
CREATE INDEX ix_users_company ON users (company_id, role);

PRAGMA foreign_keys = ON;
