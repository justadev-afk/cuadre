# Cuadre

Validación automática de pago móvil. A cashier types the reference a customer
reads off their bank receipt; Cuadre asks the merchant's bank whether that
payment actually landed, and only the bank's answer approves the sale.

The engineering rules live in [`CLAUDE.md`](./CLAUDE.md). This file is how to
run it.

---

## What is real today

| Piece | State |
|---|---|
| Worker, custom domain, D1, KV, queue, secrets | deployed and serving |
| Schema (migrations 0001, 0002) | applied |
| Domain rules, repositories, KV stores | in progress |
| Bank port + registry (strategy) | built |
| Banesco adapter | in progress — **has never spoken to the bank** |
| Use cases | not started |
| Screens (27 in the design) | not started |

**Authentication and Account Inquiry are proven against Banesco's real QA** (see
below). A payment has not been confirmed end to end only because the bank's
confirmation endpoint path 404s — an open question with them, not a fault in the
adapter.

---

## Running it

Node 22 is required — wrangler refuses anything older, and `.nvmrc` pins it.

```bash
nvm use
bun install
bun run dev            # vinext dev, port 3001
```

`wrangler dev` emulates D1 and KV on disk, which is why there is no staging
environment. Point local runs at a `.dev.vars` (git-ignored):

```ini
ENVIRONMENT   = "development"
APP_BASE_URL  = "http://localhost:3001"
MAIL_FROM     = "no-responder@jsansossio.com"
SUPPORT_EMAIL = "soporte@jsansossio.com"
CREDS_KEY     = "<base64 of 32 random bytes>"
IP_PEPPER     = "<32 random hex chars>"
BANK_EGRESS_IP = "0.0.0.0"
```

```bash
bun run migrate:local   # apply migrations to the on-disk D1
bun run verify          # typecheck + biome + tests — must pass before a deploy
```

## Deploying

One environment, and it is production.

```bash
bun run migrate:remote
bun run deploy          # vinext build && wrangler deploy
```

### Seeding the first admin

There is no admin sign-up screen — `/admin/login` is unlinked, so the first
platform admin is minted out of band. The script prints one INSERT (its
password hashed with the same PBKDF2 parameters the Worker verifies against);
apply it with `--file`, never `--command` (see below):

```bash
bun run seed:admin "you@example.com" "your-password" "Your Name" > /tmp/admin.sql
npx wrangler d1 execute cuadre --remote --file=/tmp/admin.sql -y
```

Use `--file`, never `--command "$SQL"`: the PBKDF2 hash is
`pbkdf2$<iter>$<salt>$<hash>`, and a double-quoted shell variable expands the
`$` segments, silently corrupting it so the account cannot sign in. A live test
admin is already seeded: `contact@jsansossio.com`.

There is a matching `scripts/seed-demo.ts` that seeds the DOÑA AURORA acceptance
scenario — a company, a cashier, and a Banesco **sandbox** account already
connected with the Confirmación credentials — so a real pago-móvil validation
can be exercised from the till without the onboarding wizard (which needs the
two-credential model; see `CLAUDE.md`). Pass it the environment's `CREDS_KEY`.

Secrets are managed with `wrangler secret` and never live in the repo:

```bash
npx wrangler secret put CREDS_KEY
npx wrangler secret list
```

Live at **https://cuadre.jsansossio.com** — a placeholder until `cuadre.ve` is
bought. Moving domain means changing `APP_BASE_URL`, `MAIL_FROM` and the route
in `wrangler.toml` together; a mismatch breaks password-reset links in a way
that only shows up in somebody's inbox.

> `cuadre.julio.com.ve` was tried first. Cloudflare accepted the custom domain
> and reported the trigger deployed, but never wrote the DNS record — the
> `.com.ve` delegation was still answering NXDOMAIN fifteen minutes later while
> the zone apex resolved. `jsansossio.com` was live in seconds.

**Never run a bare `wrangler deploy`.** The Vite plugin compiles `wrangler.toml`
into `dist/server/wrangler.json` during the build, and that generated file is
the deploy target. Deploying without rebuilding ships the *previous* build's
routes and vars, and reports success naming the old ones.

---

## How a validation works

The cashier gives four things — full reference, payer's phone, issuing bank
(Sudeban code) and the amount being charged. The first three come from the
customer's receipt; the amount the till already knows.

1. Ask the bank for that exact reference.
2. If it reports nothing, retry automatically with the last 6 digits plus the
   phone, the bank code and today's date. The cashier types nothing new.
3. Compare the bank's movement against the counter: it must be a credit, on the
   connected account, for the exact amount, in bolívares.
4. On a match, insert the validation. `UNIQUE (bank_account_id, reference)`
   means a second cashier cannot charge the same payment.
5. Show a six-digit control code for the receipt.

Anything else is **"todavía no aparece"**, with *Reintentar* and *Verificar
datos* — never "rejected". A payment from another bank can take minutes to
settle, and that is not the cashier's mistake.

Only confirmed payments become rows. A failed attempt goes to Workers Logs and
Analytics Engine, which is where the failure *rate* is worth measuring.

---

## Adding a bank

`src/application/ports/bank-gateway.ts` is the interface;
`src/adapters/banks/registry.ts` picks the implementation from the account's
`bank` column.

1. Add `src/adapters/banks/<bank>/gateway.ts` exporting
   `make<Bank>Gateway(deps): BankGateway`.
2. Add it to the array in `registry.ts`.

That is the whole change. No migration — `bank` is plain TEXT with no CHECK
constraint on purpose — and no branch in any use case. The adapter owns its
bank's vocabulary and normalises everything on the way out: integer cents,
epoch seconds, four-digit Sudeban codes.

---

## Banesco integration status — verified live against QA

Two of the three feared blockers turned out not to exist. What was actually
established by calling the bank on 2026-08-06:

- **OAuth works.** The flow is the `password` grant and the client is its own
  resource owner: the token comes back for `username=<clientId>` +
  `password=<clientSecret>`, the same pair as client auth, no separate API
  user. (`client_credentials` is refused — service accounts are off.) The
  onboarding form is two fields again, as designed.
- **No IP whitelisting in QA.** An Account Inquiry from an ordinary, undeclared
  IP returned HTTP 200 with the merchant's real accounts. The integration
  document's "blocker #1" does not hold for QA. `BANK_EGRESS_IP` still ships but
  gates nothing.
- **Account Inquiry works end to end.** `POST /customer/products` returns the
  accounts (masked) in the `httpStatus`/`dataResponse` envelope.

Still open:

1. **Confirmation endpoint path 404s.** The published path carries a repeated
   `transactions/transactions/financial-account` segment; it and ~12 nearby
   variants return the OpenShift router's own "Resource not found". The gateway
   recognises the doubled prefix, so the mapping exists but the backend route
   under it does not resolve — a question for Banesco, not a path to guess.
2. **Production hosts/realm** were never supplied — only QA. The code throws
   rather than guessing a URL.
3. **Account numbers come back masked** from Account Inquiry, but Confirmation
   needs the full 20 digits — so onboarding has the merchant complete the
   number and validates it against the mask.
4. **QA credentials expire.** `creds_expire_at` is stored and warned on 7 days
   out; the bank has not stated the date.

---

## Layout

```
worker/index.ts     fetch + queue. Wiring only.
src/app/            the screens and route handlers (vinext App Router)
src/domain/         pure rules — match, money, phone, slug, control code, shift
src/application/    use cases + the ports they consume
src/adapters/       d1 · kv · banks · mail · metrics · queue
src/shared/         errors · result · clock · id · crypto · logger
migrations/         numbered, forward-only
```
