/**
 * Manual live smoke against Banesco QA — NOT a test, and never run by CI.
 *
 * §12 of CLAUDE.md is firm: never call a real bank from a test. This honours
 * that. It is a script the maintainer runs by hand to confirm the QA
 * integration still answers — the same category as `seed-demo.ts`, a tool rather
 * than part of `bun run test`. The regression that guards the *logic* lives in
 * `gateway.test.ts` against recorded fixtures; this proves the *wire* is still
 * live, on demand.
 *
 * Credentials come from the environment, never from a committed file, so the
 * secret exists only in the shell that runs this and is never seen by the repo:
 *
 *   BANESCO_QA_CONFIRMATION_CLIENT_ID=... \
 *   BANESCO_QA_CONFIRMATION_CLIENT_SECRET=... \
 *   bun run scripts/banesco-smoke.ts
 *
 * It authenticates on the Confirmación client and looks up the known QA pago
 * móvil the way the counter now does — **last six digits of the reference,
 * payer's phone, payer's bank code and the date** — which is the one search
 * modality Banesco offers for a pago móvil. Prints PASS/FAIL and exits non-zero
 * on anything but a confirmed match, so it can gate a manual release check.
 *
 * Override the target with BANESCO_QA_REFERENCE / BANESCO_QA_PAYER_PHONE /
 * BANESCO_QA_SOURCE_BANK / BANESCO_QA_ON_DATE if the QA fixture ever moves. Set
 * BANESCO_DEBUG=true to see the exact body that goes out.
 */
import { BanescoGateway } from '../src/adapters/banks/banesco/gateway.ts';
import type { BankGatewayDeps } from '../src/application/ports/bank-gateway.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(
      `Missing ${name}. This smoke reads the QA Confirmación creds from the env:\n` +
        '  BANESCO_QA_CONFIRMATION_CLIENT_ID=... BANESCO_QA_CONFIRMATION_CLIENT_SECRET=... \\\n' +
        '  bun run scripts/banesco-smoke.ts\n',
    );
    process.exit(2);
  }
  return value;
}

/** An in-memory stand-in for the token-cache KV — this is a one-shot process. */
function memoryKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  } as unknown as KVNamespace;
}

const deps: BankGatewayDeps = {
  tokens: memoryKv(),
  egressIp: process.env.BANK_EGRESS_IP ?? '0.0.0.0',
  userAgent: 'Cuadre/1.0 (banesco-smoke)',
  // On by default here: the whole point of running this by hand is to see the
  // wire. The bodies carry a phone and a reference and nothing secret.
  debug: process.env.BANESCO_DEBUG !== 'false',
};

const credentials = {
  clientId: required('BANESCO_QA_CONFIRMATION_CLIENT_ID'),
  clientSecret: required('BANESCO_QA_CONFIRMATION_CLIENT_SECRET'),
};

const gateway = new BanescoGateway(deps);

// The QA pago móvil is ref 12346090431; the counter asks by its last six.
const reference = process.env.BANESCO_QA_REFERENCE ?? '090431';
const payerPhone = process.env.BANESCO_QA_PAYER_PHONE ?? '584143775031';
const sourceBankId = process.env.BANESCO_QA_SOURCE_BANK ?? '0134';
const onDate = process.env.BANESCO_QA_ON_DATE ?? new Date().toISOString().slice(0, 10);

const session = await gateway.authenticate('sandbox', credentials);
if (!session.ok) {
  process.stderr.write(`❌ authenticate failed: ${session.error}\n`);
  process.exit(1);
}

const found = await gateway.findPayment(session.value, {
  reference,
  payerPhone,
  sourceBankId,
  onDate,
  sessionId: 'banesco-smoke',
});

if (!found.ok) {
  process.stderr.write(`❌ findPayment failed: ${found.error}\n`);
  process.exit(1);
}

if (found.value !== null) {
  const movement = found.value.movement;
  process.stdout.write(
    `✅ PASS — ref ${reference}: ${movement.isCredit ? 'CR' : 'DB'} ${movement.amountCents} cents ` +
      `(${movement.currency}), reportado como ${movement.reference}\n`,
  );
  process.exit(0);
}

process.stderr.write(
  `❌ ref ${reference}: el banco no reporta ese pago móvil.\n` +
    `   Se preguntó con teléfono ${payerPhone}, banco ${sourceBankId}, fecha ${onDate}.\n` +
    '   Revisa que los cuatro coincidan con el pago de QA: la búsqueda por últimos\n' +
    '   6 dígitos exige los cuatro, y falla en silencio si alguno no cuadra.\n',
);
process.exit(1);
