# CLAUDE.md — cuadre

Rules for anyone, human or agent, writing code in this repository. If a rule
here conflicts with the design documents, fix both in the same change.

Related documents (Claude Design project `ae632916`):
`Cuadre - Documento técnico.dc.html` · `Banesco - Integración.dc.html` ·
`Cuadre.dc.html` (the 27 screens) · design system **Nocturne**.

**Current status: live against Banesco QA, awaiting certification.** The Worker,
the custom domain, D1, KV, the queue and the secrets are all real, and so is the
bank: a cashier validated a real QA pago móvil end to end (ref `12346090431` →
CR Bs 630, control code `582422`). The IP blocker the integration document
predicted turned out not to exist in QA (§9).

What is left is the bank's own sign-off. Banesco reviewed the app on 2026-08-11
and asked for three changes — pago móvil only, the reference's **last six
digits** plus phone, bank code and **date**, and those fields actually reaching
them. All three are implemented (§9); the next step is sending them the test
evidence, after which they issue production credentials.

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

**A push to `main` publishes: it auto-deploys.** The Cloudflare git integration
builds and ships `main` on every push, so a push *is* a deploy — there is no
separate `bun run deploy` to run afterwards, and "push" and "publish" are the
same request. Two consequences follow. First, never push to checkpoint: a push
goes live. Second, **a schema migration is not part of the auto-deploy** —
`wrangler d1 migrations apply --remote` stays a deliberate, separate step, and a
*breaking* migration (a dropped or retyped column the running code depends on)
must be applied right around the push, never left behind it, so prod code and
prod schema never diverge for longer than a moment.

**Work on `main`; never create a branch** unless the maintainer asks for one in
that turn. This repo is trunk-based: commit straight to `main`. A stray feature
branch is friction nobody asked for, so the default "branch first" habit does
not apply here.

**When you *are* asked to deploy, use `bun run deploy`, never a bare `wrangler
deploy`.** The Cloudflare Vite plugin compiles `wrangler.toml` into
`dist/server/wrangler.json` at build time, and *that* generated file is what
gets deployed. Skipping the build ships the previous build's bindings, vars and
routes — silently, with a success message naming the old values.

**Finish clean: run `bun run fix`, then leave `bun run check` and `bun run
typecheck` green.** The last thing every change does, before it is called done, is
clear Biome — no lint or format error rides along in a commit. CI gates on it, so
a red check is a broken build, not a nit for later.

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
│   ├── api/             every mutation, one route handler each (see §3)
│   └── _lib/            the guards, the endpoint table, the client hook
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
| **Adapters** (`src/app`, `src/adapters`, `worker`) | Pages, route handlers, D1, KV, bank clients, mail, queue. | Everything |

Hard rules:

- **Domain is pure.** No `fetch`, no `Date.now()`, no `crypto`, no `env`, no
  SQL. Time and randomness arrive as parameters (`Clock`, `IdGen` ports).
- **Ports are narrow and use-case shaped.** Declare the interface where it is
  consumed. Never `Repository<T>`.
- **A use case never imports a concrete adapter.** If it does, its test needs
  `vi.mock` on our own code — that is the smell.
- **Every mutation is a route handler under `src/app/api/`. There are no Server
  Actions.** They were all of them, and they were replaced after one connected a
  bank, committed the row, and never answered — the merchant sat under a spinner
  over work that had already succeeded. A handler is a `Request` in and a
  `Response` out, which is a contract the framework cannot half-finish, and it is
  the one part of the Next surface that vinext does not reimplement. The shape is
  fixed and shared:
  - `src/app/_lib/api-guard.ts` — `requireApi(area)`, `requireApiCompany()`,
    `requireCompanyScope(form)`. A refusal is a **200** with `{ ok: false, error }`
    (the form renders it); a caller with no usable session is a **401**, never a
    redirect — an endpoint that answers a `fetch` with an HTML login page is a
    page the caller parses as JSON.
  - `src/app/_lib/endpoints.ts` — every URL, named once. The folder and this
    table are the two halves of one contract, and only this file spells a path.
  - `src/app/_lib/use-endpoint-action.ts` — `useEndpointAction(url, initial)`
    returns `useActionState`'s exact triple, so a screen moved across by changing
    one import. It refreshes the route on success (what `revalidatePath` did),
    turns a 401 into a sign-out, and turns a dead network into a refusal — so no
    dialog can spin forever again. `postJson` is the same for the two screens that
    speak JSON (the counter's charge, the cashier's list).

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

- **The port is what Cuadre needs**, not what a bank offers: authenticate, and
  find one pago móvil. A term from a bank's manual — "modalidad", `dataRequest`,
  `transactionDetail` — appearing outside that bank's folder means the port has
  leaked. It listed a merchant's accounts and a day's movements too, until
  Banesco asked us to drop both (2026-08-11): a pago móvil is found by phone,
  bank code and date, so the receiving account was never part of the question.
- **How much of the reference a bank is asked with is the bank's answer**, not
  the screen's: `referenceDigits` on the port (six, for Banesco). The counter's
  field, its placeholder and the refusal that guards it all read that number, so
  a second bank moves them without a line changing on the till.
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
- **Two kinds, three searches, and the kind is stored** (`validations.kind`,
  0008). A pago móvil is made *from* a phone, so it requires one and a
  transferencia has none at all — `payer_phone` is nullable and the column that
  says which is which is explicit, because "phone is null" is a guess, not a
  fact. What each search takes is the gateway's `paymentKinds`, never a branch in
  a use case, and the bank refuses **silently** — `70001 · sin resultados` — when
  a field is missing or one it did not ask for is present. See §9 for the table.
- **The date is the cashier's, and "hoy" follows the clock.** A till stays open
  all night: the field holds `null` for *hoy* and resolves the day at submit,
  never at render, or an 8am charge would quietly ask about yesterday.
- **A payment is identified by what the bank answers, not by what was typed.**
  `paymentKey` is the bank's canonical reference — or, when the bank echoes back
  only the tail it was given, that tail paired with the day it happened. That key
  is what `ux_validations_payment` is unique over, and the row of record carries
  the one built from the *movement*.
- **The "ya cobrado" check runs twice, and the first one is a prediction.** The
  key is a composition of what the cashier typed, so it can be built before the
  bank is asked — and for a bank that answers with the tail it was asked with
  (Banesco) the prediction is character for character the stored key, so a
  re-scanned receipt answers instantly instead of spending a round trip in front
  of a customer. It is safe because it can only be **wrong by missing**: a bank
  that answers with a fuller reference keys its rows on that, the prediction
  finds nothing, and the check after the movement catches it. A hit is never
  false — a row under that key on that connection *is* that payment, by the same
  definition the unique index enforces.
- **Only confirmed payments are stored.** An attempt with no match creates no
  row — it is not an accounting fact, it is a retry. It lives in Workers Logs
  and Analytics Engine, which is where the "todavía no aparece" rate is
  measurable. This is why the company panel needs no status filter.
- **One payment, one charge.** `UNIQUE (bank_account_id, reference_key)` is the
  entire anti-double-charge mechanism: two cashiers racing the same payment, one
  INSERT wins. Both checks above are conveniences in front of it, never a
  substitute — the index is the only thing that arbitrates a race.
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
- **A user row is never deleted. Access is `users.status`, and it goes both
  ways.** `validations.cashier_id` names whoever confirmed each payment and has
  to keep naming them years later, so somebody who leaves is `disabled` and
  somebody disabled by mistake is switched back to `active` from the same button.
  The repository offers `setStatus` and no delete at all — there is no
  `deleteEmployee` use case any more, and the two-ending "delete if they have no
  history, disable if they do" that used to sit there is gone with it. Disabling
  ends the next sign-in *and* the sessions already open (see §7).
  **Nobody changes their own access**, in either direction: `updateEmployee`
  takes the acting user off the session and refuses `own_access`, and the panel
  does not draw the switch on your own row. The last-administrator count does not
  cover this — a shop with two owners would let one of them lock themselves out —
  and the name and the PIN stay editable, because a name is not a permission.
  The list is ordered administrators first, then cashiers, in `listEmployees`
  rather than in a screen: a shop is one or two people who run the panel and a
  till per counter, and by name alone the two accounts that can do anything sink
  under "Caja 1, Caja 2, Caja 3".
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
- **A `bank_accounts` row is a connection to a bank, not a bank account.** There
  is no account number on it since 0007 — a pago móvil is found by phone, bank
  code and date. What it carries is the bank, the environment, an optional
  `label` the merchant names it with (what the counter's *banco receptor*
  dropdown shows), and the credentials. Two affiliations of one bank are told
  apart by `client_id_last6`, which is the fourth column of the unique key.
- **The credentials are one sealed JSON value on that row.** A map from the
  bank's own credential-group key to its pair — `{"confirmation": {...}}` —
  AES-GCM sealed then base64 (`creds_ct`/`creds_iv`/`creds_key_v`). 0003 had
  split it into a row per pair to make the shape visible; with Banesco's second
  client gone there is no shape left to see, and a column is the simpler thing
  that is still true. Each bank stores whatever it needs in there and nothing
  outside its adapter reads the shape. What survives in the clear is the last 6
  of the operate client id, which is all the UI shows.
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
- **But it is checked against the row it names, on every request.** `resolveSession`
  reads `users.findStanding` — one indexed statement that answers "is this user
  still active" and "is their company still active" together — and a session whose
  account is gone, disabled or suspended resolves to **`revoked`**: the KV record
  is deleted on the spot, pages redirect through `/session-ended`, and the
  endpoints answer **401**, which the client turns into a sign-out.
  This is not belt-and-braces. Revoking a user's sessions at the moment it
  happens (`deleteAllForUser`) is a `list` over a KV reverse index, and a session
  whose index key was never written survives it — which is exactly what happened:
  a deleted cashier kept a working till. The KV sweep is still done, because it is
  instant for the sessions it does find; the row is what makes the answer true.
- **Not-a-live-session has one place that decides where it goes**
  (`app/_lib/session-exit.ts`): anonymous → the area's login, superseded or
  revoked → `/session-ended`, which clears the cookie first. Nine screens made
  that call inline and each knew about two of the three states.
- **Shift confirmation is switched off.** `SHIFT_CONFIRMATION_ENABLED` in
  `src/domain/shift.ts` is `false`, so `needsShiftConfirmation` never answers
  true and nothing interrupts a till: a shift lasts what it lasts, and a session
  ends when somebody signs out, signs in elsewhere, or loses the account behind
  it. It is a constant rather than a deletion — the rule, the acknowledgement use
  case, the dialog and `POST /api/shift-ack` are all intact and tested, one flip
  away from live. Everything below this line describes the feature **as it
  behaves when that constant is `true`**; do not restate it as current behaviour.
  The switch is the only place that decides: never gate the prompt a second time
  in a layout or a screen.
- **Shift confirmation at 4 h.** Four hours after sign-in the app blocks the
  screen with the name and username of whoever holds the session — *Continuar*
  or *Cerrar sesión*. Nothing logs out automatically if nobody answers.
- **The counter lives in the session record** (`shiftAckAt`), not the client.
  Reloading the page or opening a second tab does not dodge it.
- **Opening the app is presence: a cold start restarts the four hours.** The
  session records `lastSeenAt`, and the resolve path (`KvSessionStore.touch` →
  the pure `shiftAckOnResume`) restarts the clock when a session is seen again
  after a real gap — the app was closed, or a phone pocketed and taken back out.
  Greeting someone with *¿sigues en caja?* the instant they launch the till is a
  prompt they answer by launching it. A quick reload is too small a gap to
  reset, so F5 still cannot dodge a prompt that is genuinely due — the two are
  told apart by `SHIFT_RESUME_GAP_SECONDS` (15 min), and `lastSeenAt` is written
  on a slower cadence that stays comfortably under it.
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
  (the credentials email pasted copy-paste debris after it). **Proven end to end
  in the UI**: a cashier validated ref `12346090431` → CR Bs 630 → control code
  `582422`, persisted.

### The certification meeting (2026-08-11) — what the bank asked for

Banesco reviewed the app live. Three requirements, all now implemented:

1. **Validate pago móvil only**, by its own modality: the **last six digits** of
   the reference, the payer's phone, their bank's Sudeban code and the date of
   the operation (manual V1.3 §VI, example c). The phone is therefore required.
2. **They were not receiving the bank code or the phone** — and they were right.
   The old flow asked by *exact reference* first and only fell back to the shape
   that carries them, so a search that answered "sin resultados" on the first
   call never sent either. There is one call now and it always carries all four
   fields. `BANESCO_DEBUG=true` prints method, path and body to prove it.
3. **The date of the operation is a field**, defaulted to today on the checkout.

### The second round (2026-08-12) — a transferencia is two questions

The bank read our traces and answered: the pago móvil fields are right, and
**a transferencia is validated two different ways** depending on where the money
came from. What they saw in our traffic was only the Banesco→Banesco shape;
there was no interbank request at all, because we sent one shape for both.

There are three modalities now, not two, and the payer's Sudeban code chooses
between the last two — `isInterbankTransferencia` in
`banesco/confirmation.client.ts`, one rule read by the request and by the name
the row is recorded under:

| | asked with |
|---|---|
| Pago móvil | reference tail · `phoneNum` · `bankId` · `startDt` |
| Transferencia Banesco→Banesco | **whole** reference · `accountId` · `bankId` — **no date** |
| Transferencia interbancaria | reference **tail** · `accountId` · `bankId` · `startDt` |

**The till asks for the date on both kinds, and the adapter decides whether it
travels.** A cashier is never asked "¿fue interbancaria?" — the question is
answered by the bank they already picked, and one field that means two different
things to the bank is exactly the kind of knowledge a counter must not carry.
Sending `startDt` to the internal modality still turns a movement into
`70001 · sin resultados` (verified 2026-08-11), so the drop happens in
`findTransferencia` and is tested there.

The interbank shape is the **manual's**, not something we have watched answer:
QA holds no interbank movement (§ *Still open*, 2). It is the modality V1.3 of
the manual added "para solo Transferencias Interbancarias".

### Consulta de Saldo is not used, and that is a decision with evidence

**Banesco splits its two APIs across two OAuth clients that cannot call each
other's service** (each 403s on the other): Consulta de Saldo is `17a43e72`,
Confirmación de Transacciones is `0fedfa00`, under *different RIFs* (J500769300
against J003075523). Only Confirmación is asked for.

The second client is not merely inconvenient, it is **useless for the one job it
looked right for**. Probed against QA on 2026-08-11 with both pairs in hand:
Consulta returns the merchant's accounts **masked** — `0134************5306`,
with type and balance — and the payment search answers **400** to every one of
them, passed through as reported *and* stripped of its asterisks. Only the full
twenty digits answer (`01340804108041005394` → ref 150496, CR Bs 525,08). A
credential that cannot produce a usable account number is a credential not worth
asking a merchant for, so the group is gone from the gateway, the client and its
endpoint are deleted, and the bank has been told we do not need it in production.

What replaces it is the merchant's own list: the accounts that receive
transferencias are typed on the connection, one at a time, checked as they are
added against the bank's own `receivingAccountRule` (length, prefix, copy), and
**editable afterwards** from the bank card. `scripts/seed-demo.ts` seeds the demo
connection exactly as `connect` writes one.

### Production credentials — live since 2026-08-17

The bank sent the production pair for DOÑA AURORA, and both halves were verified
against the real hosts the same day:

- **The token endpoint answers.** Same password grant with the client as its own
  resource owner, on realm **`realm-api-prd`** of the `proplakur` cluster. A
  300-second token, same reply shape as QA.
- **The confirmation endpoint answers**, and its path is **not QA's**:
  `/financial-account/transactions`, with no `/transactions` prefix — production
  sits behind a 3scale gateway and the QA path returns `404 · No Mapping Rule
  matched`. A search for a reference that does not exist comes back as the bank's
  own envelope, `70001 · Consulta sin resultados`, carried on an HTTP **400**
  rather than QA's 200 — which the client already handles, because it parses the
  body before it looks at the status.
- Auth is enforced there: no token and a bad token both answer **403**
  (QA answers 401), and `failureForHttpStatus` reads both as
  `rejected_credentials`.

So `banescoEndpoints` no longer throws, `hasProductionEndpoints` is gone, and the
environment-mismatch probe on a sandbox onboarding is **live** — a QA client is
unknown to the production realm and comes back 401, which is what says a
connection filed as a test really is one.

### Still open with Banesco

1. **QA has no interbank test data.** The bank said so in the meeting, so the
   only movements we can prove end to end — pago móvil and transferencia alike —
   are their own Banesco→Banesco ones. The interbank request is built from the
   manual and answers `70001`, which is the honest evidence to send: the shape is
   provable, the match is not.
2. **`cuadre.ve` is not owned.** The app runs on `cuadre.jsansossio.com` and
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
  `SearchableSelect` (Popover + Command), `Calendar` (react-day-picker, Spanish
  and Caracas-timed by default), `Tooltip` (hover *and* focus, so a hint is not
  mouse-only), `sonner` toasts — before inventing a parallel one. A table keeps the one bespoke `.table` class inside a `Card`. The
  default `Button` variant is an accent *outline*, never a fill. An error in a
  modal is a **toast**, never a line that resizes the dialog.
- **A filter never takes the table away.** A list that comes back empty keeps
  its columns and puts the "no hay resultados" card *underneath* — the merchant
  is adjusting those columns, and replacing them with a box hides the thing being
  adjusted. The card names the filter that emptied the list ("Ana Pérez no tiene
  validaciones en este período"), because a bare "no hay validaciones" under a
  narrowed table reads as "you have no payments", which is a different and much
  more alarming sentence. On a phone there is no table to keep, so the card is
  all there is.
- **Every screen is a desktop/mobile pair.** The design presents them side by
  side; both are in scope for every change. The shell folds at 900px, most
  desktop/mobile swaps at `md` (768px).
- Phosphor icons for app content (the `Icon` component); `lucide-react` only
  inside the shadcn primitives (chevrons, the dialog close). Interactive states
  are themed, never browser defaults: `:focus-visible` is the 2px accent ring.
- **The same question is asked with the same form** — see §11.

---

## 11. Two screens that ask the same thing are one component

If two flows ask the merchant for the same thing, they render the *same* form.
Not a similar one, not one built from the same primitives — the same file.

The one that made this a rule: connecting a bank and changing a connected
account's credentials both ask for "which bank, which environment, one pair per
service", and were two hand-written modals. They had already drifted — one hid
the optional pairs behind a disclosure and the other listed them, one showed a
bank picker and the other a chip, one showed the waiting overlay over the bank
round trip and the other froze. Nobody decided any of that. It is what happens
to a copy.

The rule is not "don't repeat yourself" everywhere; it is narrower and it binds:

- **A form is shared by its fields**, and what wraps them is the caller's — the
  title, the hidden ids, the endpoint it posts to, what happens on success. When one
  flow may not change a field (bank and environment are a connected account's
  identity), it renders **the same control, disabled**, never a different widget.
  A merchant should recognise the form they already filled.
- **A wire format is declared once and read once.** `<groupKey>.clientId` is a
  contract between a client component and a route handler; both sides get it from
  `banks/credentials.ts` and neither spells the dot itself. A convention that
  lives in two files drifts in one of them, silently, and drops credentials.
- **A rule that decides money is written once.** "Every filled group is
  authenticated, a required one missing is a refusal" is one function
  (`application/banking/credential-groups.ts`) that `connect` and `change` both
  call — never the same loop twice. So is "are these two spellings the same
  payment?": `sameReference` lives in `src/domain/payment-match.ts` and the
  Banesco adapter imports it to pick its candidate row, rather than keeping the
  near-copy of it that used to sit in `gateway.ts`.
- **One failure, one sentence.** Bank failure copy is a single table
  (`banks/bank-messages.ts`), and the bank is a *parameter*: a bank's name
  hardcoded in shared copy is the §4 leak in prose form.
- **One answer shape for every mutation.** `ActionState` (`{ ok, error }`) is
  what a route handler answers and what `useActionOutcome` reacts to — close on
  success, toast on refusal — so a dialog does not hand-roll the two effects and
  get the dependency array subtly right by luck.
- **One endpoint per question, not one per caller.** Connecting a bank was two
  Server Actions over one shared core, because a merchant and a platform admin
  ask it from different screens. It is one handler now, and *whose* company is
  being touched is `requireCompanyScope`: an admin names the company in the form,
  a merchant's own id comes off the session and a `companyId` field in their
  request is ignored.

Before adding a screen, search for the one that already asks the question. The
second copy is cheaper to write today and is the whole cost of the feature
forever after. Extract when the second caller appears, not in anticipation of
one — but when it appears, extract, do not paste.

---

## 12. Testing

| Level | Scope |
|---|---|
| Domain unit | Payment match, money, phone, slug, control code, shift. Table-driven — **the table is the specification**. |
| Use case | Hand-written fakes of the ports. Orchestration and failure paths. |
| Adapter | Row→domain mapping; the UNIQUE-index outcome parsing; bank response parsing against recorded fixtures. |
| Form wire (`src/app`) | What a client component names and a route handler reads back — `banks/credentials.test.ts`. The contract, never the JSX. |

- Tests live next to their subject as `*.test.ts`.
- **Fakes over mock frameworks.** `vi.mock` on our own module means a missing port.
- **Never call a real bank from a test.**
- Every bug fix arrives with the test that would have caught it.
