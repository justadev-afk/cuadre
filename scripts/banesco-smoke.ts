/**
 * Manual live smoke against Banesco QA — NOT a test, and never run by CI.
 *
 * §11 of CLAUDE.md is firm: never call a real bank from a test. This honours
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
 * It authenticates on the Confirmación (operate) client and looks up the known
 * QA pago móvil — ref 12346090431 → CR Bs 630 on the …5394 account. Prints
 * PASS/FAIL and exits non-zero on anything but a confirmed match, so it can gate
 * a manual release check. Override the target with BANESCO_QA_REFERENCE /
 * BANESCO_QA_ACCOUNT / BANESCO_QA_PAYER_PHONE / BANESCO_QA_SOURCE_BANK /
 * BANESCO_QA_ON_DATE if the QA fixture ever moves.
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
};

const credentials = {
  clientId: required('BANESCO_QA_CONFIRMATION_CLIENT_ID'),
  clientSecret: required('BANESCO_QA_CONFIRMATION_CLIENT_SECRET'),
};

const reference = process.env.BANESCO_QA_REFERENCE ?? '12346090431';
const accountId = process.env.BANESCO_QA_ACCOUNT ?? '01340804108041005394';
const payerPhone = process.env.BANESCO_QA_PAYER_PHONE ?? '584143775031';
const sourceBankId = process.env.BANESCO_QA_SOURCE_BANK ?? '0134';
const onDate = process.env.BANESCO_QA_ON_DATE ?? new Date().toISOString().slice(0, 10);
const tail = `…${accountId.slice(-4)}`;

const gateway = new BanescoGateway(deps);

const session = await gateway.authenticate('sandbox', credentials);
if (!session.ok) {
  process.stderr.write(`❌ authenticate failed: ${session.error}\n`);
  process.exit(1);
}

const found = await gateway.findPayment(session.value, {
  reference,
  accountId,
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
      `(${movement.currency}) via ${found.value.strategy} on account ${tail}\n`,
  );
  process.exit(0);
}

// Not on the connected account. Re-ask with the account filter OFF (an empty
// accountId makes the last-four check a no-op) to reveal whether the bank has
// this payment at all, and on which account — the whole point when a validation
// says "todavía no aparece" but the payment plainly exists.
const probe = await gateway.findPayment(session.value, {
  reference,
  accountId: '',
  payerPhone,
  sourceBankId,
  onDate,
  sessionId: 'banesco-smoke-probe',
});

if (probe.ok && probe.value !== null) {
  const onAccount = probe.value.movement.accountMasked || '(sin máscara de cuenta)';
  process.stderr.write(
    `❌ ref ${reference} EXISTE, pero en la cuenta ${onAccount} — no en la conectada ${tail}.\n` +
      `   Conecta la cuenta ${onAccount} (es la que recibió el pago), no la ${tail}.\n`,
  );
  process.exit(1);
}

process.stderr.write(
  `❌ ref ${reference}: el banco no lo reporta ni ignorando la cuenta.\n` +
    '   O estas credenciales de Confirmación no ven ese pago (otro RIF/afiliación),\n' +
    '   o el dato de QA cambió. No es la cuenta: es el pago o las credenciales.\n',
);
process.exit(1);
