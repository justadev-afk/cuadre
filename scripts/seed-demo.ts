/**
 * Seeds the DOÑA AURORA acceptance scenario, end to end, as SQL.
 *
 * This exists because Banesco splits its two APIs across two separate OAuth
 * clients — Consulta de Cuentas (17a43e72) and Confirmación de Transacciones
 * (0fedfa00) — and neither can call the other's service. The onboarding wizard
 * lists accounts through Consulta, but a cashier validates through
 * Confirmación, so a bank account connected with one client cannot be validated
 * with it. This seeds a bank account straight into the "connected" state with a
 * single **Confirmación** credential pair — which the counter uses whatever its
 * usage, by the single-credential rule — which is what a real pago-móvil
 * validation needs.
 *
 * It seals exactly as `connect-bank-account.ts` does — the credential pair onto
 * its own `bank_account_credentials` row and the account number onto the
 * account — so `validate-payment.ts` unseals it unchanged. The sealing key must
 * be the one the target environment uses:
 * `.dev.vars`' CREDS_KEY for local, the Worker secret for production. Pass it
 * as the first argument.
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
// The receiving account the test pago móvil landed on (ref 12346090431, Bs 630).
const ACCOUNT_NUMBER = '01340804108041005394';

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

// One credential pair (Confirmación), sealed then base64-encoded onto its own
// row. A single-pair account, so the counter uses this pair whatever its usage.
// The account number is stored in the clear (§6), so it is not sealed.
const sealedCreds = await seal(credsKey, CONFIRMATION);
const clientIdLast6 = CONFIRMATION.clientId.slice(-6);

const companyId = COMPANY_ID;
const cashierId = `demo-cashier-${randomBytes(4).toString('hex')}`;
const companyUserId = `demo-company-${randomBytes(4).toString('hex')}`;
const bankAccountId = `demo-bank-${randomBytes(4).toString('hex')}`;
const credentialId = `demo-cred-${randomBytes(4).toString('hex')}`;

const statements = [
  // Company (idempotent-ish: the slug is the PK).
  `INSERT OR REPLACE INTO companies (id, name, rif, industry, status, created_at) VALUES (${q(companyId)}, ${q('Doña Aurora Panadería y Pastelería')}, ${q('J-00307552-3')}, ${q('Panadería')}, 'active', ${q(nowIso)});`,

  // Company administrator (email + password), so the merchant panel is reachable.
  `INSERT OR REPLACE INTO users (id, company_id, role, name, email, username, password_hash, status, created_at) VALUES (${q(companyUserId)}, ${q(companyId)}, 'company', ${q('Andreína Pérez')}, ${q(COMPANY_EMAIL)}, NULL, ${q(hashPassword(COMPANY_PASSWORD))}, 'active', ${q(nowIso)});`,

  // Cashier: (company_id, username) + PIN. No email, by CHECK constraint.
  `INSERT OR REPLACE INTO users (id, company_id, role, name, email, username, password_hash, status, created_at) VALUES (${q(cashierId)}, ${q(companyId)}, 'cashier', ${q('María Rodríguez')}, NULL, ${q(CASHIER_USERNAME)}, ${q(hashPassword(CASHIER_PIN))}, 'active', ${q(nowIso)});`,

  // The Banesco sandbox account, already "connected". The full account number is
  // stored in the clear; timestamps are ISO-8601 UTC text.
  `INSERT OR REPLACE INTO bank_accounts (id, company_id, bank, environment, client_id_last6, account_number, account_last4, account_type, holder_id, verified_at, creds_expire_at, status, created_at) VALUES (${q(bankAccountId)}, ${q(companyId)}, 'banesco', 'sandbox', ${q(clientIdLast6)}, ${q(ACCOUNT_NUMBER)}, '5394', 'DDA', ${q('J003075523')}, ${q(nowIso)}, NULL, 'active', ${q(nowIso)});`,

  // Its single Confirmación credential pair, sealed then base64-encoded onto its row.
  `INSERT OR REPLACE INTO bank_account_credentials (id, bank_account_id, cred_key, usage, client_id_last6, creds_ct, creds_iv, creds_key_v, created_at) VALUES (${q(credentialId)}, ${q(bankAccountId)}, 'confirmation', 'operate', ${q(clientIdLast6)}, ${q(toBase64(sealedCreds.ciphertext))}, ${q(toBase64(sealedCreds.iv))}, ${sealedCreds.keyVersion}, ${q(nowIso)});`,
];

process.stdout.write(`${statements.join('\n')}\n`);

process.stderr.write(
  [
    'seeded DOÑA AURORA demo:',
    `  company slug : ${companyId}`,
    `  cashier      : ${companyId} / ${CASHIER_USERNAME} / PIN ${CASHIER_PIN}`,
    `  company login: ${COMPANY_EMAIL} / ${COMPANY_PASSWORD}`,
    `  bank account : Banesco sandbox · ····5394 (Confirmación creds)`,
    '',
  ].join('\n'),
);
