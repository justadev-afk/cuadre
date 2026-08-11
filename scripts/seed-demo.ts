/**
 * Seeds the DOÑA AURORA acceptance scenario, end to end, as SQL.
 *
 * A company, its administrator, a cashier, and a Banesco **sandbox connection**
 * already in the "connected" state — the state the (now single-step) wizard
 * would leave it in, so the till is usable the moment the database is reset.
 *
 * It seals exactly as `connect-bank-account.ts` does: the whole credential map
 * as one JSON value on `bank_accounts.creds_ct` (migration 0007), so
 * `validate-payment.ts` unseals it unchanged. The sealing key must be the one
 * the target environment uses: `.dev.vars`' CREDS_KEY for local, the Worker
 * secret for production. Pass it as the first argument.
 *
 *   bun run scripts/seed-demo.ts <CREDS_KEY> > /tmp/demo.sql
 *   wrangler d1 execute cuadre --local --file=/tmp/demo.sql -y
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';

import { epochToIso } from '../src/shared/clock.ts';
import { seal, toBase64 } from '../src/shared/crypto.ts';

const credsKey = process.argv[2];
if (!credsKey) {
  process.stderr.write('usage: bun run scripts/seed-demo.ts <CREDS_KEY>\n');
  process.exit(1);
}

// Banesco QA — Confirmación de Transacciones affiliation for DOÑA AURORA.
const CONFIRMATION = {
  clientId: '0fedfa00',
  clientSecret: '93da683469162053068ec67f35b0020c',
  // The client is its own resource owner in the password grant.
  username: '0fedfa00',
  password: '93da683469162053068ec67f35b0020c',
};
// What the merchant calls this connection — the counter's "banco receptor".
const LABEL = 'Caja principal';
// The account the QA transferencia landed in (ref 00000150496 → CR Bs 525,08).
// It has to be the full twenty digits: the bank refuses a masked one with a 400,
// and Consulta de Saldo only ever reports masked — which is exactly why this is
// something the merchant registers (and can edit) rather than something we
// discover, and why that service is not asked for at all.
const RECEIVING_ACCOUNTS = ['01340804108041005394'];

const COMPANY_ID = 'dona-aurora';
const CASHIER_USERNAME = 'maria.r';
const CASHIER_PIN = '4821';
const COMPANY_EMAIL = 'admin@dona-aurora.test';
const COMPANY_PASSWORD = 'DonaAurora2026';

function hashPassword(plaintext: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(plaintext, salt, 100_000, 32, 'sha256');
  return `pbkdf2$100000$${salt.toString('base64')}$${derived.toString('base64')}`;
}

function q(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const now = Math.floor(1_786_060_000); // a fixed recent instant; scripts have no clock
const nowIso = epochToIso(now); // timestamp columns are ISO-8601 UTC text (migration 0004)

// The credential map — keyed by the adapter's own credential-group key — sealed
// as one JSON value, then base64. Exactly what `connect-bank-account.ts` writes.
const sealedCreds = await seal(credsKey, { confirmation: CONFIRMATION });
const clientIdLast6 = CONFIRMATION.clientId.slice(-6);

// Stable ids, not random ones. `INSERT OR REPLACE` only means "re-seed" if the
// primary keys are the same twice: with random ids a second run left the old
// rows behind (and the cashier's `(company_id, username)` unique index refused
// the new one), and — worse — every live session in KV still named a user id
// that no longer existed, so the next charge died on a foreign key at the
// INSERT with the bank already asked. Deterministic ids make reseeding idempotent
// and keep an open till working across one.
const companyId = COMPANY_ID;
const cashierId = `${COMPANY_ID}-cashier-maria`;
const companyUserId = `${COMPANY_ID}-admin`;
const bankAccountId = `${COMPANY_ID}-banesco-sandbox`;

const statements = [
  // Company (idempotent-ish: the slug is the PK).
  `INSERT OR REPLACE INTO companies (id, name, rif, industry, status, created_at) VALUES (${q(companyId)}, ${q('Doña Aurora Panadería y Pastelería')}, ${q('J-00307552-3')}, ${q('Panadería')}, 'active', ${q(nowIso)});`,

  // Company administrator (email + password), so the merchant panel is reachable.
  `INSERT OR REPLACE INTO users (id, company_id, role, name, email, username, password_hash, status, created_at) VALUES (${q(companyUserId)}, ${q(companyId)}, 'company', ${q('Andreína Pérez')}, ${q(COMPANY_EMAIL)}, NULL, ${q(hashPassword(COMPANY_PASSWORD))}, 'active', ${q(nowIso)});`,

  // Cashier: (company_id, username) + PIN. No email, by CHECK constraint.
  `INSERT OR REPLACE INTO users (id, company_id, role, name, email, username, password_hash, status, created_at) VALUES (${q(cashierId)}, ${q(companyId)}, 'cashier', ${q('María Rodríguez')}, NULL, ${q(CASHIER_USERNAME)}, ${q(hashPassword(CASHIER_PIN))}, 'active', ${q(nowIso)});`,

  // The Banesco sandbox connection, already "connected": credentials sealed onto
  // the row, timestamps ISO-8601 UTC text.
  `INSERT OR REPLACE INTO bank_accounts (id, company_id, bank, environment, label, receiving_accounts, client_id_last6, creds_ct, creds_iv, creds_key_v, verified_at, creds_expire_at, status, created_at) VALUES (${q(bankAccountId)}, ${q(companyId)}, 'banesco', 'sandbox', ${q(LABEL)}, ${q(JSON.stringify(RECEIVING_ACCOUNTS))}, ${q(clientIdLast6)}, ${q(toBase64(sealedCreds.ciphertext))}, ${q(toBase64(sealedCreds.iv))}, ${sealedCreds.keyVersion}, ${q(nowIso)}, NULL, 'active', ${q(nowIso)});`,
];

process.stdout.write(`${statements.join('\n')}\n`);

process.stderr.write(
  [
    'seeded DOÑA AURORA demo:',
    `  company slug : ${companyId}`,
    `  cashier      : ${companyId} / ${CASHIER_USERNAME} / PIN ${CASHIER_PIN}`,
    `  company login: ${COMPANY_EMAIL} / ${COMPANY_PASSWORD}`,
    `  bank         : Banesco sandbox · ${LABEL} (Confirmación creds)`,
    '',
  ].join('\n'),
);
