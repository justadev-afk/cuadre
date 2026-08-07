/**
 * Mints the first platform admin.
 *
 * There is no sign-up screen and there never will be: `/admin/login` is an
 * unlinked route for the platform team, so the first row has to come from
 * somewhere outside the product. That somewhere is here.
 *
 * It prints SQL rather than writing to the database, so the same command works
 * against the local D1 and the remote one and the operator sees exactly what
 * will run:
 *
 *   bun run scripts/seed-admin.ts <email> <password> "<name>" > /tmp/admin.sql
 *   npx wrangler d1 execute cuadre --remote --file=/tmp/admin.sql -y
 *
 * Use `--file`, NOT `--command "$SQL"`: the hash format is
 * `pbkdf2$<iter>$<salt>$<hash>`, and passing it through a double-quoted shell
 * variable expands `$<iter>` and `$salt` as (empty) shell variables, silently
 * corrupting the hash so the account can never sign in. `--file` reads the SQL
 * verbatim.
 *
 * The password is hashed here with the *same* parameters as
 * `src/shared/crypto.ts` — PBKDF2-SHA256, 100k iterations, 16-byte salt,
 * 256-bit output, stored as `pbkdf2$<iterations>$<salt-b64>$<hash-b64>`. If
 * that format changes there, it changes here, and the assertion at the bottom
 * of this file is what will notice.
 */
import { pbkdf2Sync, randomBytes, randomUUID } from 'node:crypto';

import { epochToIso } from '../src/shared/clock.ts';

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_BYTES = 32;

function hashPassword(plaintext: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = pbkdf2Sync(plaintext, salt, PBKDF2_ITERATIONS, DERIVED_BYTES, 'sha256');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

/** SQL string literal. Single quotes double up; nothing else needs escaping in SQLite. */
function quote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const [email, password, name] = process.argv.slice(2);

if (!email || !password || !name) {
  process.stderr.write('usage: bun run scripts/seed-admin.ts <email> <password> "<full name>"\n');
  process.exit(1);
}

if (password.length < 8) {
  // The same floor `isValidPassword` enforces. A seeded account that the login
  // screen would have refused is a trap for whoever tries to change it later.
  process.stderr.write('password must be at least 8 characters\n');
  process.exit(1);
}

const id = randomUUID();
const now = Math.floor(Date.now() / 1000);

// `company_id` is NULL and `username` is NULL: the CHECK constraints in
// migration 0001 read that combination as the platform admin, and would reject
// any other shape for this role.
//
// One line, no interior newline. `wrangler d1 execute --command` rejects a
// statement that contains a newline ("unrecognized token"), and the import
// endpoint that `--file` uses needs a scope the CLI login does not always
// carry — so a single-line statement piped to `--command` is the path that
// works against both local and remote.
process.stdout.write(
  `INSERT INTO users (id, company_id, role, name, email, username, password_hash, status, created_at) ` +
    `VALUES (${quote(id)}, NULL, 'admin', ${quote(name)}, ${quote(email.toLowerCase())}, NULL, ${quote(hashPassword(password))}, 'active', ${quote(epochToIso(now))});`,
);

process.stderr.write(`admin ${email} → ${id}\n`);
