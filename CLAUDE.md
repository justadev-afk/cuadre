# CLAUDE.md — cuadre

Rules for anyone, human or agent, writing code in this repository. If a rule
here conflicts with the design documents, fix both in the same change.

Related documents (Claude Design project `ae632916`):
`Cuadre - Documento técnico.dc.html` · `Banesco - Integración.dc.html` ·
`Cuadre.dc.html` (the 27 screens) · design system **Nocturne**.

**Current status: skeleton deployed, bank integration blocked.** The Worker,
the custom domain, D1, KV, the queue and the secrets are all real. What is not
real is a single confirmed payment: Banesco validates its callers by IP and
Cloudflare Workers has no fixed egress address (§9, blocker #1). Until that is
closed, the Banesco adapter is written and tested against fakes but has never
spoken to the bank.

---

## 0. Language

**Everything in the codebase is English**: identifiers, file names, directory
names, comments, commit messages, log events, error codes, database columns and
**route paths** (`/login`, `/checkout`, `/my-validations`).

The only Spanish is copy a user reads. It lives in two places and nowhere else:
the message table in `src/shared/errors.ts`, and the JSX of `src/app/`. A
Spanish identifier in a diff is a change request, not a nit.

---

## 1. Stack

vinext (the Next 16 API reimplemented on Vite) · Cloudflare Workers · D1 · KV ·
Queues · Email Sending · Analytics Engine · **Tailwind v4** (`@tailwindcss/vite`) ·
**shadcn/ui** primitives (Radix + CVA, in `src/components/ui/`) · TypeScript
`strict` · **Biome** · **bun** · Node pinned in `.nvmrc` (v22 — wrangler refuses
anything older).

```bash
bun install
bun run dev          # vinext dev
bun run typecheck    # tsc --noEmit, must pass clean
bun run check        # biome check .  — lint is not optional, CI gates on it
bun run fix          # biome check --write .
bun run test
bun run deploy       # vinext build && wrangler deploy
```

**Never deploy or push on your own.** `bun run deploy`, `wrangler deploy`,
`git push` and anything else that publishes must wait for the maintainer to ask
for it in that turn — do not run them to "finish", to checkpoint, or because the
build is green. Commit locally when asked; publishing is always a separate,
explicit request. (This rule overrides any earlier instruction to deploy/push at
the end of a task.)

**Work on `main`; never create a branch** unless the maintainer asks for one in
that turn. This repo is trunk-based: commit straight to `main`. A stray feature
branch is friction nobody asked for, so the default "branch first" habit does
not apply here.

**When you *are* asked to deploy, use `bun run deploy`, never a bare `wrangler
deploy`.** The Cloudflare Vite plugin compiles `wrangler.toml` into
`dist/server/wrangler.json` at build time, and *that* generated file is what
gets deployed. Skipping the build ships the previous build's bindings, vars and
routes — silently, with a success message naming the old values.

**vinext is beta.** The version is pinned exactly (`1.0.0-beta.4`, no caret).
Keep the code inside the Next 16 surface and the escape hatch stays open: the
same `src/app/` runs under `next` if something blocks. Do not depend on
build-time static prerender — every route here is dynamic and authenticated.

**The UI is Tailwind v4 + shadcn.** The bespoke Nocturne CSS was retired to a
360-line `globals.css`: the palette now lives twice there — shadcn's semantic
tokens (`--background`, `--primary`, `--card`, …) and Nocturne's raw ramps
(`--color-*`), joined by `@theme inline` so `bg-card`/`text-primary` and
`bg-[var(--color-accent-800)]` both resolve, without the two ever colliding.
Nocturne's base element styles sit in `@layer base` so utilities win over them.
Build screens from the `src/components/ui/*` primitives + Tailwind utilities; the
one bespoke class left is `.table` (its inset-fade row rule has no utility). `@/`
aliases `src/` (declared in both `vite.config.ts` and `tsconfig.json`).

---

## 2. Layout

```
worker/index.ts          Worker entry: fetch (delegates to vinext) + queue. Wiring only.
src/
├── app/                 vinext App Router — the UI and HTTP adapter
├── container.ts         builds adapters from env, returns use cases
├── env.ts               bindings + vars, parsed with zod
├── domain/              pure rules: match, money, phone, slug, control code, shift
├── application/
│   ├── ports/           the interfaces the use cases consume
│   └── */               one use case per file
├── adapters/
│   ├── d1/              repositories, hand-written prepared statements
│   ├── kv/              session · bank tokens · rate limits
│   ├── banks/           registry.ts + one folder per bank
│   ├── mail/            Email Sending
│   ├── metrics/         Analytics Engine
│   └── queue/           the consumer
└── shared/              errors · result · clock · id · crypto · logger
migrations/              numbered SQL, forward-only
```

---

## 3. Architecture — three layers, dependencies point inward

| Layer | Contains | May import |
|---|---|---|
| **Domain** (`src/domain`) | Payment match, money, phone, slug, control code, shift rule. Pure functions, plain data. | Nothing but its own types |
| **Application** (`src/application`) | One use case per file: `validatePayment`, `connectBankAccount`, `signIn`. | Domain + **port interfaces** |
| **Adapters** (`src/app`, `src/adapters`, `worker`) | Pages, server actions, route handlers, D1, KV, bank clients, mail, queue. | Everything |

Hard rules:

- **Domain is pure.** No `fetch`, no `Date.now()`, no `crypto`, no `env`, no
  SQL. Time and randomness arrive as parameters (`Clock`, `IdGen` ports).
- **Ports are narrow and use-case shaped.** Declare the interface where it is
  consumed. Never `Repository<T>`.
- **A use case never imports a concrete adapter.** If it does, its test needs
  `vi.mock` on our own code — that is the smell.

### Functions or classes — the line

The deciding question is *does it hold anything*, not which layer it is in.

| Shape | Written as | Examples |
|---|---|---|
| A stateless rule over its arguments | **exported function** | `src/domain/*`, `matchPayment`, `normalisePhone` |
| A collaborator constructed with dependencies and answering several related calls | **class implementing an interface** | every gateway, repository and KV store |
| One use case, one entry point | **factory closure** returning the function | `makeValidatePayment({ banks, validations, clock })` |

A gateway has four methods sharing a token cache, a device envelope and an
environment. A closure returning an object literal can express that, but
`class BanescoGateway implements BankGateway` says it in the declaration and
puts the compiler's error on the class that drifted rather than on whoever
tried to use it. So:

- **Adapters are classes**, one per collaborator, `implements` its port.
  Dependencies arrive through the constructor and live in `private readonly`
  fields. No inheritance between adapters — two banks share the port, never a
  base class.
- **Ports are `interface`**, not `type`, so `implements` reports against the
  adapter.
- **Never a class for a pure rule**, and never one just to group functions.
  A class with no fields is a namespace, and we do not use namespaces.
- Still no DI container, no decorators, no reflection. Construction is explicit
  in `src/container.ts`.

---

## 4. Banks are a strategy, not a branch

`src/application/ports/bank-gateway.ts` is the one interface every bank
implements. `src/adapters/banks/registry.ts` maps `bank_accounts.bank` to a
gateway at call time.

- **The port is what Cuadre needs**, not what a bank offers: authenticate, list
  accounts, find one payment, list a day. A term from a bank's manual —
  "modalidad", `dataRequest`, `transactionDetail` — appearing outside that
  bank's folder means the port has leaked.
- **Adding a bank is an adapter plus a registry entry.** Never a migration:
  `bank` is plain TEXT with no CHECK constraint, on purpose. If a feature needs
  a per-bank branch in a use case, it is designed wrong.
- **Every adapter normalises**: integer cents, epoch seconds, 4-digit
  zero-padded Sudeban codes, trimmed currency. A bank returning `"1240.00"` and
  `"BS "` is that adapter's problem, and solving it twice is how a float
  comparison eventually approves a payment it should not have.
- `null` from `findPayment` is a **success**. It means "the bank does not report
  this payment yet" — the copy says *Todavía no aparece*, never "rejected".

---

## 5. The rules that decide money

- **Approval is born from the bank's movement, never from the screen.** Nothing
  typed at the counter is taken on trust: amount, currency, credit/debit and
  reference are all compared against what the bank returned. This lives in
  `src/domain/payment-match.ts` and is table-tested.
- **Amount is exact.** No tolerance. Integer cents, always.
- **Only confirmed payments are stored.** An attempt with no match creates no
  row — it is not an accounting fact, it is a retry. It lives in Workers Logs
  and Analytics Engine, which is where the "todavía no aparece" rate is
  measurable. This is why the company panel needs no status filter.
- **One payment, one charge.** `UNIQUE (bank_account_id, reference)` is the
  entire anti-double-charge mechanism: two cashiers racing the same reference,
  one INSERT wins.
- **Idempotency.** The client sends an `idempotencyKey` per attempt; retrying
  the same submission returns the same validation and the same control code.
- **`is_sandbox` is copied onto every validation**, never joined. Delete the
  sandbox account tomorrow and the history still knows which rows were tests.
  Cash totals exclude sandbox, always.

---

## 6. Data rules

- **No ORM.** Hand-written prepared statements on D1.
- **Repositories return domain types, never raw rows.** The mapping lives in the
  repository and is unit-tested.
- **`companies.id` is the slug** — the string the cashier types, not a uuid
  behind one. It is therefore **immutable**: it appears in every foreign key.
  A company is renamed through `name`; its slug never changes.
- **The cashier login tuple is `(company_id, username)`**, which is literally
  what is typed on the login screen: `la-espiga` + `maria.r`.
- **Money is INTEGER cents.** Always, everywhere.
- **The domain works in epoch seconds; the database stores ISO-8601 UTC.**
  Timestamps compare and order as epoch-seconds numbers in the domain, but the
  columns hold `2026-08-07T18:42:12Z` TEXT (migration 0004) so a human or an IDE
  can read a row. The repositories convert at the boundary (`epochToIso` /
  `isoToEpoch` in `clock.ts`); ISO-8601 UTC sorts the same lexically as
  chronologically, so `created_at DESC` indexes keep working. Nothing in the
  domain ever sees a date string.
- **No BLOB columns.** They are unreadable in the tools the team inspects data
  with. What was sealed is stored as **base64 TEXT** instead.
- **The client secret is sealed; the account number is not.** The OAuth client
  secret is AES-GCM sealed (then base64) — it is a password. The full account
  number is **stored in the clear** (`account_number` TEXT): it is the merchant's
  own receiving account, not sensitive enough to seal. What the UI shows is still
  the last 4 of the account and the last 6 of the client id. Credentials live one
  pair per row in `bank_account_credentials` (`cred_key`, `usage`, own key
  version), never as a JSON blob on the account; **an account is written together
  with at least one pair or not at all** — the invariant is enforced in
  `D1BankAccountRepository.insert`, not just intended (migrations 0003–0004).
- **IPs are stored hashed** with `IP_PEPPER`, never raw.
- **Migrations** are numbered and forward-only. A destructive migration ships
  alone, after a backup, never with feature work.

---

## 7. Sessions and shifts

- Session in KV (`session:<id>`), cookie `HttpOnly; Secure; SameSite=Lax; Path=/`.
  The id rotates on sign-in.
- **The session never expires on its own.** In a shop, throwing a cashier out
  mid-sale is worse than the risk it avoids. The KV TTL slides on every request
  and the cookie is persistent.
- **Shift confirmation at 4 h.** Four hours after sign-in the app blocks the
  screen with the name and username of whoever holds the session — *Continuar*
  or *Cerrar sesión*. Nothing logs out automatically if nobody answers.
- **The counter lives in the session record** (`shiftAckAt`), not the client.
  Reloading the page or opening a second tab does not dodge it.
- **No query without `company_id` in the `WHERE`.** That is the boundary
  between merchants, and it is not negotiable in a review.

---

## 8. Workers specifics

- **Nothing mutable at module scope** — isolates are shared across requests.
- **Work after the response** goes to `ctx.waitUntil` or the queue. Never a
  dangling promise.
- **`env` is parsed once with zod** (`src/env.ts`). A missing binding fails
  loudly, not as `undefined.prepare` three layers down.
- **Secrets only via `wrangler secret`.** Never in code, never in a response,
  never in a log — not the client secret, not a bank token, not a full account
  number, not a full reference in the clear (`maskReference`).
- **The queue is for deferred work only.** Password-reset mail and bank calls
  that hit maintenance. Validating a payment is synchronous or it is nothing.
- **PBKDF2 is capped at 100 000 iterations.** Workers' WebCrypto throws
  `NotSupportedError` above it *at runtime only* — `wrangler dev` uses Node's
  crypto and runs any count, so a higher number is green in every local test
  and then 500s every login in production (it cost us exactly that once, with
  the digest hidden in a prod build). `PBKDF2_ITERATIONS` in `src/shared/
  crypto.ts` and both seed scripts stay at 100 000, and `verifyPassword` reads
  the count from the stored hash — so raising it means re-hashing every row, not
  just changing the constant. The same ceiling is why any Workers-side stretch
  that wants more must chain calls, never ask for more in one.

---

## 9. Deliberately not doing, and why

- **No Durable Objects.** The technical document proposed one per bank account
  to serialise bank calls. It does not earn its place: with an exact-reference
  lookup each validation is a *single* call, so serialising two cashiers only
  adds latency at the counter — the worst place to add it. The control code
  needs no counter either: `UNIQUE (company_id, control_code)` in D1 *is* the
  serialisation point, and a conflict means retry. The OAuth token cache is KV
  with a TTL, as the integration document itself specifies.
- **No staging environment.** One Worker, one database, one set of secrets. The
  bank's sandbox is selected per *account* (the `environment` column), not per
  deployment — a company can hold production and sandbox accounts at once, so a
  second Worker would only split the history in two.
- **No landing page.** The app opens at `/login`.
- Also not doing: an ORM · a DI container or decorators · barrel files ·
  monorepo · a shared types package · mocking our own modules · npm or yarn.

### Banesco — verified live against QA (2026-08-06), not inferred

- **OAuth is the `password` grant with the client as its own resource owner:**
  `username=<clientId>`, `password=<clientSecret>`. `client_credentials` is
  refused (service accounts off). So the onboarding form is two fields.
- **No IP whitelisting in QA.** A real Account Inquiry from an undeclared IP
  returned 200 with the merchant's accounts. The integration doc's "blocker #1"
  is false for QA; `BANK_EGRESS_IP` gates nothing.
- **Responses are the nested `httpStatus`/`dataResponse` envelope** — parse it
  in `banesco/envelope.ts`, never flat.

- **Confirmation endpoint** is `/transactions/financial-account/transactions`
  (the credentials email pasted copy-paste debris after it). Both search modes
  return the test pago móvil. **Proven end to end in the UI**: a cashier
  validated ref `12346090431` → CR Bs 630 → control code `582422`, persisted.

### The two-client problem (resolved: a per-pair credentials table)

**Banesco splits its two APIs across two separate OAuth clients that cannot call
each other's service** (each 403s on the other): Consulta de Cuentas is
`17a43e72`, Confirmación de Transacciones is `0fedfa00`, with different RIFs.

The onboarding wizard lists accounts through **Consulta**, but a cashier
validates through **Confirmación** — so a bank account connected with one client
**cannot be validated with it**. The one-credential-pair-per-account model was
wrong for Banesco, and it is now fixed structurally: **an account carries its
pairs in `bank_account_credentials`, one row each**, keyed by the bank's
credential-group key (`confirmation`, `consulta`) and tagged with a `usage`
(`operate` for the counter, `discover` for the alta). `operateCredential` picks
the pair the counter runs on — the `operate` one, or, for a single-pair bank,
that lone pair whatever its usage says. Adding a pair is a row, not a column,
and no use case branches per bank. `scripts/seed-demo.ts` seeds the demo account
plus its Confirmación row the same way `connect` does.

### Still open with Banesco

1. **Production hosts/realm unknown.** Only QA supplied. `endpoints.ts` throws
   rather than guessing.
2. **Account Inquiry returns masked account numbers**, Confirmation needs the
   full 20 digits — onboarding completes the number against the mask.
4. **`cuadre.ve` is not owned.** The app runs on `cuadre.jsansossio.com` and
   mail sends from the same zone. All three move together when the domain is
   bought: the route, `APP_BASE_URL` and `MAIL_FROM` in `wrangler.toml`.
   (`cuadre.julio.com.ve` was the first choice; Cloudflare accepted the custom
   domain and reported the trigger deployed but never wrote the DNS record —
   the `.com.ve` delegation was still not answering fifteen minutes later,
   while the zone apex resolved fine.)

---

## 10. Design fidelity

The 27 screens are the specification, not a suggestion. The palette (Nocturne's,
kept) lives in `src/app/globals.css`; the components are Tailwind + shadcn.

- **Take every colour, font, spacing and radius from a token or utility.** A hex
  literal in a component is a review rejection — reach for a Tailwind utility
  (`bg-card`, `text-primary`, `rounded-xl`) or, for a Nocturne ramp, an arbitrary
  value onto its token (`bg-[var(--color-accent-800)]`).
- **Build with the shadcn primitives** in `src/components/ui/` — `Button`,
  `Input`, `Label`, `Dialog`, `Select`, `Tabs`, `Card`, `Badge`, `Alert`,
  `SearchableSelect` (Popover + Command), `sonner` toasts — before inventing a
  parallel one. A table keeps the one bespoke `.table` class inside a `Card`. The
  default `Button` variant is an accent *outline*, never a fill. An error in a
  modal is a **toast**, never a line that resizes the dialog.
- **Every screen is a desktop/mobile pair.** The design presents them side by
  side; both are in scope for every change. The shell folds at 900px, most
  desktop/mobile swaps at `md` (768px).
- Phosphor icons for app content (the `Icon` component); `lucide-react` only
  inside the shadcn primitives (chevrons, the dialog close). Interactive states
  are themed, never browser defaults: `:focus-visible` is the 2px accent ring.

---

## 11. Testing

| Level | Scope |
|---|---|
| Domain unit | Payment match, money, phone, slug, control code, shift. Table-driven — **the table is the specification**. |
| Use case | Hand-written fakes of the ports. Orchestration and failure paths. |
| Adapter | Row→domain mapping; the UNIQUE-index outcome parsing; bank response parsing against recorded fixtures. |

- Tests live next to their subject as `*.test.ts`.
- **Fakes over mock frameworks.** `vi.mock` on our own module means a missing port.
- **Never call a real bank from a test.**
- Every bug fix arrives with the test that would have caught it.
