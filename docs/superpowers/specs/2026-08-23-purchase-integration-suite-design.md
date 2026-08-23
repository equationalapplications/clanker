# Purchase Integration Test Suite — Design

**Date:** 2026-08-23 · **Status:** Approved design, awaiting implementation plan
**Scope:** Tier 1 only — genuinely-signed webhook payloads over real HTTP against a real Postgres, fully offline.
Tiers 2 (Stripe CLI / RevenueCat sandbox egress) and 3 (real device store purchases) remain parked.

## Problem

The two payment webhook handlers — `stripeWebhook` (`functions/src/stripeWebhook.ts:497`) and
`revenueCatWebhook` (`functions/src/revenueCatWebhook.ts:911`) — are covered only by unit tests that
stub or bypass their verification and persistence layers:

- The Stripe unit suite stubs `stripe.webhooks.constructEvent` itself
  (`stripeWebhook.test.ts`, helper ~line 706), so its bad-signature tests never exercise real HMAC
  verification.
- No test touches a real database; idempotency, dedupe leasing, and subscription/credit writes are
  unproven end-to-end.

This suite closes those gaps without network egress, emulators, or payment-provider sandboxes.

## Verified facts (binding — do not re-derive)

Confirmed first-hand against staging `c47baa10` on 2026-08-23:

- **Only two webhook handlers exist.** No Google Play RTDN receiver, no Apple App Store Server
  Notifications v2 code (grep for rtdn/androidpublisher/AppStoreServer/signedPayload/JWKS = zero
  source hits). Native purchases enter exclusively via RevenueCat forwarding;
  `docs/billing-architecture.md:3-9` documents the split as intentional.
- **Stripe verification:** local HMAC via `stripe.webhooks.constructEvent(req.rawBody, sig, secret)`
  at `stripeWebhook.ts:420`; secret from `STRIPE_WEBHOOK_SECRET?.trim()` (`:392`). Post-verify REST
  callbacks: `sessions.listLineItems :537`, `subscriptions.retrieve :561/:782`,
  `customers.retrieve :662/:732`, `invoices.retrieve :883`. Test seam:
  `setStripeClientFactoryForTests(factory)` `:256`; handler deps include `markEventProcessed`
  `:73/:429`.
- **RevenueCat verification:** constant-time compare (`timingSafeEqual` def `:45`, use `:492`)
  against `REVENUECAT_WEBHOOK_SECRET` (`:475`); accepts `Bearer <secret>` or bare secret. **Zero
  network calls in the entire file**; latent paths dep-injectable via the `RevenueCatDeps` second
  argument of the core fn (Firebase Auth lookup `:119`, GA4 sender defaultDeps ~`:187`).
- **Persistence is Cloud SQL Postgres only; Firestore untouched by both handlers.** Drizzle tables
  in `functions/src/db/schema.ts`: `processedStripeEvents` :87 (idempotency), `subscriptions` :43,
  `creditTransactions` :102, `creditSpendEvents` :135, `users` :25. Dedupe service
  `functions/src/services/stripeEventDedupeService.ts` — claim/complete/unmark with lease
  `PROCESSING_LEASE_MS = 5 * 60 * 1000` (:6).
- Both handlers are Firebase Functions v2, region us-central1, public invoker, exported from
  `functions/src/index.ts`. cloud-agent/Cloud Run contains zero payment code.
- RC behaviors worth asserting: SANDBOX short-circuits 200 (:560-564), TEST events (:553),
  stripe-collision warning when an active `subscriptionProvider==='stripe'` row exists (:594/:674),
  Android product-id normalization strips `:base-plan` suffix (:199-207).
- **Framework:** `functions/package.json:8` → `npm test` = tsc build then
  `node --test "lib/**/*.test.js"` (+ scripts/*.test.mjs). Jest does not work in functions/.
  Existing suites are node:test and currently 470/470 green (~7s).
- **Local infra:** root `docker-compose.local.yml` provides `postgres_db`
  (pgvector/pgvector:**pg18**, port 5432, user `clanker_dev`, pass `local_pass`, db `clanker`,
  healthchecked) matching prod's Cloud SQL PG18. Migrations run via `cd functions &&
npm run migrate:dev`. `firebase.json` has no emulators block; Stripe CLI appears nowhere in the
  repo.

## Decisions (user-approved 2026-08-23)

1. **Tier 1 only**, using existing injection seams.
2. **Genuinely HMAC-sign Stripe headers** (`t=…,v1=HMAC_SHA256(secret, "{t}.{payload}")`) instead
   of stubbing `constructEvent` — do not replicate the unit suite's blind spot.
3. **Neutralize exactly two outbound surfaces**: fake Stripe client via
   `setStripeClientFactoryForTests`; GA4 sender via injected no-op. Nothing else needs mocking.
4. **Invocation: thin HTTP server** wrapping each real exported handler; tests fire real `fetch()`
   requests with genuine signature/bearer headers. Preferred form mounts handlers on a real Express
   app if `express` is already in functions' dependency tree (authentic Request/Response objects);
   fallback is a minimal node:http adapter exposing exactly the Response surface both handlers use,
   plus manual `req.rawBody` attachment — the single Functions-runtime contract relied upon.
   Which form applies is confirmed by a one-line package.json check at plan time.
5. **Database: sibling `clanker_test` DB inside the existing compose `postgres_db` container.**
   Suite ensures the database exists, migrates it once per run, truncates between tests. Dev
   `clanker` data is never touched; a hard guard aborts if the configured target resolves to
   `clanker`.
6. **Gating: separate tsconfig + script.** New `tsconfig.int.json` compiles
   `functions/src/integration/**` to `lib-integration/`; new scripts `build:int` and
   `test:integration`. Default `npm test` stays byte-identical. `test:integration` requires
   `DATABASE_URL` and fails fast with the exact compose command and URL to copy.
7. **Lease expiry tested by backdating in SQL** (`UPDATE … SET lease_expires_at = now() - interval
'1 second'`) — zero production changes; exercises the real expiry comparison as shipped.
8. **RC Firebase Auth lookup injected via `RevenueCatDeps`** (synthetic user / not-found), not
   mock-admin-sdk.
9. **Unit-suite honesty upgrade included:** `stripeWebhook.test.ts` switched from stubbed
   `constructEvent` to genuinely-signed headers via a small `signStripeHeader()` helper. Ships as
   its own commit, never mixed with suite scaffolding.

## Architecture

### File layout

```
functions/
  tsconfig.int.json              → lib-integration/
  package.json                   + build:int, test:integration scripts
  src/integration/
    README.md                    compose prereq, run command, env contract
    helpers/
      httpHarness.ts             server lifecycle + rawBody attachment + fetch client
      signing.ts                 real Stripe HMAC signer · tamper helper · RC bearer builder
      db.ts                      ensure clanker_test → migrate once → truncateAll()
    stripeWebhook.int.test.ts
    revenueCatWebhook.int.test.ts
```

Each `.int.test.ts` runs standalone (`node --test lib-integration/src/integration/<file>.js`).

### Component responsibilities

| Unit             | Does                                                                                                                                                                                                        | Depends on                                                 |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `httpHarness`    | boots HTTP server on ephemeral port (port 0), buffers body into `req.rawBody`, invokes the exported handler, returns `{ url, close() }`                                                                     | nothing app-specific                                       |
| `signing`        | produces genuine `t=…,v1=…` Stripe headers over exact wire bytes; valid-sig-over-different-bytes tamper helper; `Bearer`/bare RC authorization values                                                       | node:crypto                                                |
| `db`             | preflight `SELECT 1`; `CREATE DATABASE clanker_test` if absent; Drizzle migration once per run; `truncateAll()` = TRUNCATE five payment tables RESTART IDENTITY CASCADE; shared pg pool with clean shutdown | DATABASE_URL, drizzle migrations                           |
| Stripe test file | matrix rows S1–S6 + D1–D3 via harness + fake stripe client fixtures                                                                                                                                         | httpHarness, signing, db, `setStripeClientFactoryForTests` |
| RC test file     | matrix rows R1–R8 via harness + full `RevenueCatDeps` stub object                                                                                                                                           | httpHarness, signing, db                                   |

### Environment & secrets

Tests set `STRIPE_WEBHOOK_SECRET` and `REVENUECAT_WEBHOOK_SECRET` to known throwaway values before
importing the handlers (mirrors the unit suites' `whsec_test_123` pattern). No real secrets anywhere.

### Dependency injection per invocation

- **Stripe:** factory installed via `setStripeClientFactoryForTests` returns a fake client whose
  `sessions.listLineItems`, `subscriptions.retrieve`, `customers.retrieve`, `invoices.retrieve`
  answer from per-test fixture data. Installed in `before()`, restored in `after()`.
- **RevenueCat:** every core-fn call passes an explicit `RevenueCatDeps`: Auth lookup resolves a
  synthetic user (or rejects not-found, per row R8), GA4 sender is a recorded no-op.

## Coverage matrix

Every row asserts up to three layers: (a) HTTP status + response shape, (b) exact DB state (rows
present or provably absent, key column values), (c) no side effects on failure paths. Exact event
type strings and branch-specific expectations are pinned from each handler's switch cases and
existing unit-suite fixtures during planning — the matrix fixes behavior contracts, not invented
event names.

### Stripe file

| Row | Scenario                                            | Pass criteria                                                                                                          |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| S1  | Validly-signed happy-path purchase event            | 2xx; credit grant + subscription rows written with expected columns; event marked processed in `processedStripeEvents` |
| S2  | Replay of same event ID                             | 2xx; **exactly one** credit transaction row (idempotent)                                                               |
| S3  | Valid signature over tampered bytes                 | 4xx; all five tables still empty                                                                                       |
| S4  | Missing / garbage signature header                  | 4xx; no DB writes                                                                                                      |
| S5  | Well-signed but malformed JSON body                 | Defined non-crash response; no partial writes                                                                          |
| S6  | Refund flow                                         | Refund/negative credit entry per handler semantics; balances reconcile                                                 |
| D1  | Dedupe: unclaimed event → claim                     | Claim succeeds; lease row visible in `processedStripeEvents`                                                           |
| D2  | Dedupe: second claim while lease active             | Rejected (null/no takeover)                                                                                            |
| D3  | Dedupe: backdate lease past 5-min expiry → re-claim | Takeover succeeds against real SQL comparison                                                                          |
| D4  | Dedupe: after complete/unmark, fresh claim allowed  | Claim succeeds                                                                                                         |

### RevenueCat file

| Row | Scenario                                                    | Pass criteria                                                       |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| R1  | Correct bearer, live-mode purchase event                    | 2xx; subscription upsert + credit grant                             |
| R2  | Wrong bearer                                                | 401; zero DB writes                                                 |
| R3  | Bare-secret authorization form                              | Accepted (both forms are valid per verified facts)                  |
| R4  | SANDBOX event                                               | 200 short-circuit; nothing persisted                                |
| R5  | TEST event type                                             | Handler-defined ack; no persistence                                 |
| R6  | Event for user with existing active `provider='stripe'` row | Collision-warning path taken; defined outcome; stripe row untouched |
| R7  | Android product id `productId:base-plan`                    | Stored normalized, suffix stripped                                  |
| R8  | Injected Auth lookup returns user-not-found                 | Handler-defined response; no orphan rows                            |

## Harness failure modes

- **DB unreachable** → one actionable preflight error at run start (names the compose command),
  never twenty confusing per-test timeouts.
- **Migration failure** → abort before any test runs; never test half-migrated.
- **File-level parallelism** → `node --test` runs files as parallel workers and both files truncate
  shared tables; `test:integration` pins `--test-concurrency=1` (two files — sequential costs
  nothing).
- **Hung runs** → per-test timeout (~10s); `afterAll` closes servers and drains the shared pool so
  the process exits cleanly.
- **Wrong-target protection** → `db.ts` refuses to operate on any database named `clanker`.

## Self-verification & acceptance criteria

- Every auth mechanism carries a red-provable negative (S3, S4, R2): if the signer or harness were
  silently wrong, those rows fail — the suite cannot pass vacuously.
- Truncate honesty is asserted implicitly by the no-writes rows.
- **Acceptance:** `npm run test:integration` green end-to-end; default functions suite still
  470/470; `tsc` clean under both tsconfigs; formatting gates (`:check` variants) pass.

## Delivery

All commits on the implementation branch cut inside the isolated worktree; PR targets `staging`,
never main. Commit sequence (no formatting changes share any commit):

1. Unit-suite honesty upgrade (`stripeWebhook.test.ts` → genuine signatures).
2. Scaffolding: `tsconfig.int.json`, package.json scripts, three helpers, README.
3. `stripeWebhook.int.test.ts` (S1–S6, D1–D4).
4. `revenueCatWebhook.int.test.ts` (R1–R8).

No new DB migrations are introduced (existing schema suffices), so no db-migrations changelog
entry is required.

## Explicit non-goals

Firebase emulators block; Stripe CLI; RevenueCat sandbox egress; Play RTDN / Apple ASN receivers;
wiring `test:integration` into CI (needs a Postgres service container — future option); clock-
injection refactor of the dedupe service; any production code change at all.

## Deferred to the implementation plan

- Express-vs-node:http resolution for the harness (one dependency check).
- Exact res-method surface if the shim fallback is used.
- Migration application mechanics against `clanker_test` (programmatic drizzle migrator vs shelling
  `migrate:dev` with `DATABASE_URL` override).
- Concrete event-type constants and fixture shapes per matrix row.
