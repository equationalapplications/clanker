# Purchase Integration Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fully-offline integration suite that drives both real payment webhook handlers (`stripeWebhook`, `revenueCatWebhook`) over genuine HTTP with genuinely-signed payloads against a real local Postgres (`clanker_test`), proving signature verification, idempotency/dedupe leasing, and subscription/credit writes end-to-end.

**Architecture:** Four commits. (1) Upgrade the existing Stripe unit suite to genuinely HMAC-signed headers instead of stubbing `constructEvent`. (2) Scaffolding: a second tsconfig compiling `src/integration/**` to `lib-integration/` (default build excludes it), three helpers (`db.ts`, `httpHarness.ts`, `signing.ts`), README, and two npm scripts. (3) Stripe integration file covering matrix S1–S6 + D1–D4. (4) RevenueCat integration file covering R1–R8. Both test files mount the exported handler cores on a minimal `node:http` harness (no Express — phantom dependency), pass explicit deps objects whose lookups/credit/subscription/dedupe functions are the REAL service code wired to an injected test-`getDb`, and neutralize exactly two outbound surfaces: the Stripe REST client (via `setStripeClientFactoryForTests`) and the GA4 senders (recording no-ops).

**Tech Stack:** node:test (functions/ has no Jest), TypeScript 6 / NodeNext / strict, drizzle-orm + `pg` over a sibling Postgres database in the existing `docker-compose.local.yml` container, migrations via the existing `scripts/migrate-dev.mjs`, Stripe SDK v22's real `webhooks.constructEvent` for offline HMAC verification.

**Spec:** `docs/superpowers/specs/2026-08-23-purchase-integration-suite-design.md` — read it first; this plan argues from its Decisions and Coverage Matrix and does not renegotiate them.

## Global Constraints

Every task implicitly includes all of these:

- **Zero production source changes.** The only permitted edits are: `functions/src/stripeWebhook.test.ts`, new files under `functions/src/integration/**`, `functions/tsconfig.json` (one `exclude` line), new `functions/tsconfig.int.json`, `functions/package.json` (script additions only). Any change needing a `.ts` source-file edit outside those paths = stop and escalate to the user.
- **Default suite untouched.** `npm test` in `functions/` must remain byte-identical in behavior: 470/470 green baseline (report actual number honestly if it drifted).
- **PRs target `staging`, never `main`.** All commits land on branch `worktree-purchase-integration-tests` inside this isolated worktree.
- **Formatting gates are `:check` variants; formatting changes never share a commit with logic changes.** Run prettier on every file before committing it.
- **Never run `drizzle-kit generate`.**
- **`test:integration` must NOT set `NODE_ENV=test`.** `functions/src/db/cloudSql.ts:55` hard-throws under `NODE_ENV=test`; nothing in this suite ever calls cloudSql's `getDb()`, but do not poke the guard.
- **Secrets are throwaway constants** (`whsec_int_test_123`, `rc_int_secret_123`) defined in `helpers/signing.ts`. No real secret anywhere.
- **Shell discipline:** Bash tool runs zsh; `$var` does not word-split (use arrays); the worktree isolation guard rejects compound commands — issue single plain commands; cwd persists between calls, so use absolute paths or `npm --prefix <dir>`.
- Local Node is v22.19.0 vs pinned 24 → expect harmless `EBADENGINE` warnings; suites must still be green.
- Conventional Commits; trailer `Co-Authored-By: Claude <noreply@anthropic.com>` (commitlint warns footer-leading-blank — warning only, commits land).
- **DB-trigger reality (assertion rule):** the migrated schema carries trigger `handle_new_user()` which auto-inserts a free `subscriptions` row AND a 5,000-Power signup row (`transaction_type='signup'`) whenever a user row is created. Therefore NEVER assert absolute table counts on tables reachable from a seeded user; assert rows matching specific predicates (`reference_id`, `reason`, `delta`). Tests that assert true emptiness (S3–S5, R2, R4, R5, R8) seed no users at all.
- Intermittent tool "temporarily unavailable" errors: retry the same call.

## Verified seam facts (binding — do not re-derive)

All verified first-hand against this worktree @ `4caf68af` on 2026-08-23. Line refs are exact.

### Environment variables

| Var                                                                                         | Read at                                                                                                                                                   | Notes                             |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `STRIPE_WEBHOOK_SECRET`                                                                     | per-request, trimmed (`stripeWebhook.ts:392`)                                                                                                             | trailing `\n` tolerated by design |
| `REVENUECAT_WEBHOOK_SECRET`                                                                 | per-request (`revenueCatWebhook.ts:475`)                                                                                                                  |                                   |
| `STRIPE_MONTHLY_20_PRICE_ID` / `STRIPE_MONTHLY_50_PRICE_ID` / `STRIPE_CREDIT_PACK_PRICE_ID` | per-event via `getRequiredStripePriceIds()` (`stripeWebhook.ts:187-205`); env wins over Firebase params, params are try/catch'd (`runtimeConfig.ts:9-25`) | missing ⇒ handler throws ⇒ 500    |

All reads are lazy (per request/event), so plain module-top `process.env.X = ...` assignments in the test files suffice regardless of ESM import hoisting. Importing the handlers also imports `firebaseAdmin.js` (`void services.auth` lazy init) — proven harmless offline by the existing unit suites.

### Constants (`functions/src/constants/credits.ts`)

`CREDIT_PACK_AMOUNT = 10000` · `SUBSCRIPTION_RENEWAL_CREDIT_AMOUNT = 30000` · `CREDIT_PACK_EXPIRY_MS = 31*24*60*60*1000`.

### Schema columns asserted by tests (`functions/src/db/schema.ts`)

- `users`: `id` uuid pk, `firebase_uid` text unique notNull, `email` text unique notNull.
- `subscriptions`: `user_id` uuid unique fk→users, `plan_tier` default 'free' (check: free/monthly_20/monthly_50/payg), `plan_status` default 'active' (check: active/cancelled/expired), `stripe_subscription_id`, `stripe_customer_id` (unique where not null), `billing_cycle_end`, `subscription_provider` nullable (check: stripe/revenuecat), `cancel_at_period_end` bool default false.
- `processed_stripe_events`: `event_id` text pk, `status` default 'processing' (check: processing/completed), `created_at` defaultNow — **`created_at` IS the lease column**.
- `credit_transactions`: `user_id`, `delta` int, `reason` text, `reference_id` nullable, `initial_amount` int notNull, `remaining_balance` int notNull, `transaction_type` (check: signup/subscription/one_time/legacy), `expires_at`; unique index `(user_id, reason, reference_id)` where reference_id is not null.
- `credit_spend_events`: append-only; never written by these handlers.

### Injection seams

- Handler cores: `export const stripeWebhookHandler(req, res, deps = defaultDeps)` (`stripeWebhook.ts:379`) · `export const revenueCatWebhookHandler(req, res, deps = defaultDeps)` (`revenueCatWebhook.ts:464`). The `onRequest` wrappers add zero verification logic — never used by tests. Neither `defaultDeps` nor either deps _interface_ is exported → test deps objects are untyped literals validated structurally at the call site (`RevenueCatUpsertParams` IS exported, `revenueCatWebhook.ts:51`).
- `UserLookup = { id: string; email: string; firebaseUid?: string }` (`stripeWebhook.ts:27-31`).
- Stripe fake client: `setStripeClientFactoryForTests(factory: (() => Stripe) | null)` (`stripeWebhook.ts:256`); post-verification client calls only: `checkout.sessions.listLineItems(id,{limit:10})`, `subscriptions.retrieve(id)` (read `.deleted`, runtime `current_period_end` secs), `customers.retrieve(id)` (:662/:732 sub paths), `invoices.retrieve(id)` (:883).
- Real services, injectable without production edits:
  - `userRepository.findUserByEmail/findUserByFirebaseUid/findUserById` take **per-call `deps = { getDb }` as last arg** (`userRepository.ts:80-101`); email lookup normalizes via `normalizeEmailOrNull`.
  - `createSubscriptionService({ getDb })` (`subscriptionService.ts:27`): `getSubscription(userId)` returns full row or null (:29-37); `findUserIdByStripeCustomerId` :134; `upsertSubscription(params: UpsertSubscriptionParams)` — interface at :9-20: `{ userId, planTier, planStatus, currentCredits?, stripeSubscriptionId?, stripeCustomerId?, billingCycleStart?, billingCycleEnd?, subscriptionProvider?, cancelAtPeriodEnd? }`. Self-wires `createCreditService({ getDb })` when not given (:41).
  - `createCreditService({ getDb })` (`creditService.ts:122`): `renewSubscriptionCredits(userId, amount, expiresAt, referenceId)` writes `reason='subscription'`, `transaction_type='subscription'` (:457/:461) and returns boolean; `addCredits(...)`; `adjustCredits(...)`; `getLastProcessedChargeRefundTotal(chargeId)` :489-528 — legacy row with `reference_id === chargeId` ⇒ `MAX_SAFE_INTEGER`; else max numeric suffix over `reference_id LIKE '${chargeId}_%'` rows with `reason='stripe_refund'`.
  - `createStripeEventDedupeService({ getDb })` (`stripeEventDedupeService.ts:13`): full API `isEventProcessed/markEventProcessed/completeEventProcessed/unmarkEventProcessed/expireProcessingClaim`; lease stale when `created_at < now - PROCESSING_LEASE_MS` (5 min, :6); reacquire is one guarded UPDATE (:57-68); expire sets `created_at = epoch`.
- RC mapping facts: product map `{monthly_20_subscription:'monthly_20', monthly_50_subscription:'monthly_50'}` (:24-27); pack ids `{credit_pack_100, credit_100}` (:30); `normalizeRevenueCatProductId` strips at first ':' (:199-207); auth accepts `Bearer <s>` or bare `<s>`, constant-time compared (:482-498); body parse from `req.body ?? rawBody` tolerates string JSON; RC upsert maps `renewalAt → billingCycleEnd` (:148-157).

### Handler response contracts (exact)

Stripe core (`stripeWebhook.ts:379-495`): non-POST ⇒ 405 send('Method Not Allowed') · no secret ⇒ 500 send · missing/empty sig header ⇒ 400 send · `constructEvent` throw ⇒ 400 send · `markEventProcessed` false ⇒ **200 json `{received:true}` short-circuit** · dispatch ok ⇒ completeEventProcessed + **200 json `{received:true}`** · dispatch throw ⇒ unmark + **500 json `{received:false,error:'Processing error logged'}`**.

RC core (`revenueCatWebhook.ts:464-908`): non-POST ⇒ 405 send · no secret ⇒ 500 send('Webhook secret not configured') · bad auth ⇒ **401 send('Unauthorized')** · parse fail ⇒ **400 send('Invalid payload')** · `type === 'TEST'` ⇒ **200 `{received:true}`** · `environment === 'SANDBOX'` ⇒ **200 `{received:true, ignored:'sandbox'}`** · user unresolved (no `getOrCreateUserByFirebaseUid` provided) ⇒ **503 `{received:false,error:'Cloud SQL user not ready'}`** · success ⇒ 200 `{received:true}` · throw ⇒ 500 `{received:false,error:'Internal processing error'}`.

Refund tail (`stripeWebhook.ts:895-953`): pack path ⇒ `adjustCredits(user.id, -creditsToDeduct, 'stripe_refund', \`${charge.id}_${charge.amount_refunded}\`)`+ GA4 refund with`transactionId \`${charge.id}_${charge.amount_refunded}\``, `valueMinorUnits = deltaRefunded`; subscription-refund path ⇒ upsert `{planTier:'free', planStatus:'cancelled', subscriptionProvider:null, cancelAtPeriodEnd:false}`+ GA4 refund`transactionId charge.id`; neither ⇒ warn only. Deduction math: `floor(10000·qty·amount_refunded/charge.amount) − floor(10000·qty·previouslyRefunded/charge.amount)`.

RC clawback (unit-verified shape, `revenueCatWebhook.test.ts:743-779`): CANCELLATION + `cancel_reason==='CUSTOMER_SUPPORT'` ⇒ upsert free/cancelled/null + `adjustCredits(id, −30000, 'revenuecat_refund', `${otid}_${key}_refund`)` where key = `expiration_at_ms ?? transaction_id`.

### Fixture shapes (copied from unit suites)

Checkout session object (`stripeWebhook.test.ts:379-388`): `{id, customer_details:{email}, customer_email, client_reference_id:null, subscription:'sub_x'|null, customer:'cus_x', amount_total:number, currency:'usd'}`. Line items: `{data:[{price:{id}, quantity, amount_total}]}`. Sub retrieve: `{deleted:false, current_period_end:<secs>}`. RC event envelope: `{event:{type, app_user_id, product_id, expiration_at_ms?, original_transaction_id?, environment?, cancel_reason?}}`.

---

### Task 1: Unit-suite honesty upgrade — genuine Stripe signatures

**Files:**

- Modify: `functions/src/stripeWebhook.test.ts`

**Interfaces:**

- Consumes: Stripe SDK v22's real offline `stripe.webhooks.constructEvent(payload, sig, secret)`; existing `createResponseRecorder()` helper already present in the file.
- Produces: local helper `signStripeHeader(payload: string, secret: string, timestampSeconds?: number): string` in the test file (integration scaffolding reimplements the same wire format independently in Task 2 — intentional ~8-line duplication across test scopes; both pin `"t=<t>,v1=HMAC_SHA256(secret, \"<t>.<payload>\")"`).

- [ ] **Step 1: Add the signer to the top of `stripeWebhook.test.ts`**

```ts
import { createHmac } from 'node:crypto'

/**
 * Builds a genuinely-signed Stripe webhook header over the exact wire bytes:
 * `t=<unixSeconds>,v1=HMAC_SHA256(secret, "<t>.<payload>")`.
 * Used instead of stubbing constructEvent so bad-signature paths are real.
 */
const signStripeHeader = (
  payload: string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string => {
  const timestamp = String(timestampSeconds)
  const mac = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')
  return `t=${timestamp},v1=${mac}`
}

/** Convenience POST body + header pair for one signed webhook delivery. */
const signedDelivery = (payloadJson: string, secret: string) => ({
  rawBody: Buffer.from(payloadJson, 'utf8'),
  headers: { 'stripe-signature': signStripeHeader(payloadJson, secret) },
})
```

- [ ] **Step 2: Convert every `constructEvent` mock site**

Run: `grep -n "constructEvent" functions/src/stripeWebhook.test.ts`
Expected: the direct mocks near lines 133-141 and 180-190, plus the shared stub helper near line 707 (`t.mock.method(stripe.webhooks, 'constructEvent', () => event as never)`).

For each test using them, replace the mock with a real signed delivery of the SAME event serialized as JSON. Mechanical recipe per site:

1. Delete the `t.mock.method(stripe.webhooks, 'constructEvent', ...)` block (keep `setStripeClientFactoryForTests(() => stripe)` — the factory must keep serving REST-callback stubs like `listLineItems`, but now with the SDK's REAL `webhooks.constructEvent`).
2. Serialize the event the mock used to return into the payload:

```ts
// BEFORE (mocked):
const stripe = new Stripe('sk_test_123')
t.mock.method(stripe.webhooks, 'constructEvent', () => {
  return { id: 'evt_dedupe_1', type: 'checkout.session.completed', data: { object: {} } } as never
})

// AFTER (real):
const eventPayload = JSON.stringify({
  id: 'evt_dedupe_1',
  type: 'checkout.session.completed',
  data: { object: {} },
})
await stripeWebhookHandler(
  {
    method: 'POST',
    ...signedDelivery(eventPayload, 'whsec_test_123'),
  } as never,
  res as never,
  deps as never,
)
```

3. Every test must set `process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123'` (most already restore the original in `t.after`; keep that pattern and sign with the exact same constant).

Special case — the secret-trimming regression test (~line 125): it currently asserts captured args of the mock. Convert it to a behavioral proof: keep `process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123\n'` (trailing newline), sign with the TRIMMED `'whsec_test_123'`, deliver an `unhandled.event` payload, and assert `res.statusCode === 200` + `{received:true}`. If the handler failed to trim, verification would fail with 400 — same incident reproduced, now honestly.

Bad-signature tests keep their expectations but gain meaning automatically: sign over different bytes (e.g., mutate the JSON string after signing) and/or corrupt the v1 value; expect 400.

- [ ] **Step 3: Run the converted suite**

Run: `npm --prefix functions run build && cd functions && NODE_ENV=test node --test --test-reporter spec lib/src/stripeWebhook.test.js`
Expected: PASS — same test count as before the conversion, zero failures. If a test fails because it relied on impossible event shapes the mock allowed (e.g., non-JSON payloads), fix the fixture data to valid JSON carrying the same semantics — never weaken a real assertion.

- [ ] **Step 4: Full default suite unchanged**

Run: `cd functions && npm test`
Expected: 470/470 green (or current baseline count — report honestly).

- [ ] **Step 5: Prettier + commit (logic-only commit)**

Run: `npx prettier --write functions/src/stripeWebhook.test.ts && npx prettier --check functions/src/stripeWebhook.test.ts`

```bash
git add functions/src/stripeWebhook.test.ts
git commit -m "test(functions): sign real Stripe headers in webhook unit suite

Replace constructEvent mocks with genuine HMAC signatures over the exact
wire bytes so bad-signature paths exercise the shipped verification code.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Integration scaffolding — configs, scripts, three helpers, README

**Files:**

- Create: `functions/tsconfig.int.json`
- Modify: `functions/tsconfig.json` (add exclude), `functions/package.json` (scripts only)
- Create: `functions/src/integration/helpers/db.ts`, `functions/src/integration/helpers/httpHarness.ts`, `functions/src/integration/helpers/signing.ts`
- Create: `functions/src/integration/README.md`

**Interfaces:**

- Consumes: `DATABASE_URL` env (fail-fast if absent); `docker-compose.local.yml` postgres_db service running; `scripts/migrate-dev.mjs`.
- Produces (Tasks 3–4 rely on these EXACT names):
  - `signing.ts`: `INT_STRIPE_SECRET`, `INT_RC_SECRET` (string consts); `INT_PRICE_IDS = { monthly20, monthly50, creditPack }` (string consts); `signStripeHeader(payload: Buffer | string, secret: string, timestampSeconds?: number): string`; `signedStripePost(body: string): RequestInit` (sets method/headers/body); `rcAuthHeaders(form: 'bearer' | 'bare'): Record<string, string>`.
  - `db.ts`: `ensureIntegrationDatabase(): Promise<void>` (memoized: preflight SELECT 1 → CREATE DATABASE clanker_test if absent → migrate once via migrate-dev.mjs → no-op afterwards); `pool: pg.Pool`; `testGetDb: () => Promise<DbClient>` (drizzle over pool); `truncateAll(): Promise<void>`; `seedUser(firebaseUid: string, email: string): Promise<UserRow>`; `closeIntegrationPool(): Promise<void>`.
  - `httpHarness.ts`: `startWebhookServer(handler: (req: unknown, res: unknown) => Promise<void>): Promise<{ url: string; close: () => Promise<void> }>`.

- [ ] **Step 1: Exclude integration dir from the DEFAULT build**

Edit `functions/tsconfig.json` — add one key after `"include"`:

```json
  "include": ["src"],
  "exclude": ["src/integration"]
```

Why: the default test script globs `lib/**/*.test.js`; compiled `*.int.test.js` files match that glob, so without the exclusion the new suite would leak into `npm test`. Nothing under `src/` proper imports `src/integration/**`, so excluded roots stay out of `lib/` entirely. Default output is otherwise byte-identical.

- [ ] **Step 2: Create `functions/tsconfig.int.json`**

Mirrors the main config; different outDir/include only:

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "esModuleInterop": true,
    "moduleResolution": "nodenext",
    "types": ["node"],
    "noImplicitReturns": true,
    "noUnusedLocals": true,
    "outDir": "lib-integration",
    "rootDir": "src",
    "sourceMap": true,
    "strict": true,
    "target": "es2022",
    "skipLibCheck": true
  },
  "include": ["src/integration"]
}
```

Emitted layout: `lib-integration/integration/<file>.js` (rootDir `src` strips the prefix). Integration files import handler code with relative specifiers (`../../stripeWebhook.js` from a test file) — everything stays under `rootDir`, so no paths/references juggling is needed.

- [ ] **Step 3: Add npm scripts to `functions/package.json`**

Inside `"scripts"`, after `"build"`:

```json
    "build:int": "rm -rf lib-integration && tsc -p tsconfig.int.json",
    "typecheck:int": "tsc -p tsconfig.int.json --noEmit",
    "test:integration": "npm run build:int && node --test --test-concurrency=1 --test-reporter spec \"lib-integration/**/*.test.js\"",
```

Deliberate details: NO `NODE_ENV=test` anywhere (cloudSql guard throws under it); `--test-concurrency=1` because both files truncate shared tables; glob mirrors the default script's style.

- [ ] **Step 4: Write `functions/src/integration/helpers/signing.ts`**

```ts
import { createHmac } from 'node:crypto'

/** Throwaway constants — never real secrets. */
export const INT_STRIPE_SECRET = 'whsec_int_test_123'
export const INT_RC_SECRET = 'rc_int_secret_123'

export const INT_PRICE_IDS = {
  monthly20: 'price_int_monthly_20',
  monthly50: 'price_int_monthly_50',
  creditPack: 'price_int_credit_pack',
} as const

/**
 * Genuine Stripe signature over the exact wire bytes:
 * `t=<unixSeconds>,v1=HMAC_SHA256(secret, "<t>.<payload>")`.
 * Same wire format as the helper introduced in stripeWebhook.test.ts.
 */
export const signStripeHeader = (
  payload: Buffer | string,
  secret: string,
  timestampSeconds: number = Math.floor(Date.now() / 1000),
): string => {
  const bytes = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  const timestamp = String(timestampSeconds)
  const mac = createHmac('sha256', secret).update(`${timestamp}.`).update(bytes).digest('hex')
  return `t=${timestamp},v1=${mac}`
}

/** fetch() options for one genuinely-signed Stripe webhook delivery. */
export const signedStripePost = (body: string): RequestInit => ({
  method: 'POST',
  headers: { 'stripe-signature': signStripeHeader(body, INT_STRIPE_SECRET) },
  body,
})

/** RevenueCat Authorization header in either accepted form. */
export const rcAuthHeaders = (form: 'bearer' | 'bare'): Record<string, string> =>
  form === 'bearer'
    ? { authorization: `Bearer ${INT_RC_SECRET}` }
    : { authorization: INT_RC_SECRET }
```

- [ ] **Step 5: Write `functions/src/integration/helpers/httpHarness.ts`**

Both handlers touch ONLY `res.status(code).send(string)` / `res.status(code).json(object)` (grep-verified across both files) and read only `req.method`, `req.headers[...]`, `req.rawBody` (plus optional `req.body`, left undefined by the shim). So a tiny adapter over native `http.ServerResponse` satisfies them — cast through `unknown` at the boundary.

```ts
import http from 'node:http'
import type { AddressInfo } from 'node:net'

export type WebhookHandler = (req: unknown, res: unknown) => Promise<void>

export interface HarnessServer {
  url: string
  close: () => Promise<void>
}

/**
 * Boots a real HTTP server on an ephemeral port that buffers the body into
 * `req.rawBody` (the single Functions-runtime contract both handlers rely on)
 * and invokes the mounted handler. The response adapter exposes exactly the
 * surface the handlers use: status(code).send(...) / status(code).json(...).
 */
export const startWebhookServer = (handler: WebhookHandler): Promise<HarnessServer> =>
  new Promise((resolve, reject) => {
    const server = http.createServer((nativeReq, nativeRes) => {
      const chunks: Buffer[] = []
      nativeReq.on('data', (chunk: Buffer) => chunks.push(chunk))
      nativeReq.on('end', () => {
        const req = nativeReq as http.IncomingMessage & { rawBody?: Buffer }
        req.rawBody = Buffer.concat(chunks)

        const res = {
          status: (code: number) => ({
            send: (body?: string) => {
              nativeRes.statusCode = code
              nativeRes.end(body ?? '')
            },
            json: (obj: unknown) => {
              nativeRes.statusCode = code
              nativeRes.setHeader('content-type', 'application/json')
              nativeRes.end(JSON.stringify(obj))
            },
          }),
        }

        void Promise.resolve(handler(req, res)).catch(() => {
          // Handlers catch their own errors; belt-and-braces only.
          if (!nativeRes.headersSent) {
            nativeRes.statusCode = 500
            nativeRes.end('harness error')
          }
        })
      })
    })

    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      })
    })
  })
```

- [ ] **Step 6: Write `functions/src/integration/helpers/db.ts`**

```ts
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import * as schema from '../../db/schema.js'

export const TEST_DB_NAME = 'clanker_test'

const thisDir = path.dirname(fileURLToPath(import.meta.url))
// helpers → integration → lib-integration → functions/
const FUNCTIONS_ROOT = path.resolve(thisDir, '..', '..', '..')

const GUARD_GUIDANCE = [
  'test:integration requires DATABASE_URL pointing at a LOCAL Postgres.',
  '',
  'Start the database:',
  '  docker compose -f docker-compose.local.yml up -d postgres_db',
  '',
  'Then point at the sibling TEST database (never the dev "clanker" db):',
  "  export DATABASE_URL='postgres://clanker_dev:***@localhost:5432/clanker_test'",
  '',
  'Then re-run:  npm --prefix functions run test:integration',
].join('\n')

const requiredTestUrl = (): string => {
  const raw = process.env.DATABASE_URL?.trim()
  if (!raw || !raw.startsWith('postgres')) {
    // Throw (not console.error + process.exit) so node:test stays in control.
    throw new Error(GUARD_GUIDANCE)
  }
  return raw
}

const isLoopbackHost = (host: string): boolean =>
  host === 'localhost' || host === '::1' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host)

export const resolveTestUrl = (): string => {
  const url = new URL(requiredTestUrl())
  const host = url.hostname
  const dbName = url.pathname.replace(/^\//, '')
  // Hard guards BEFORE any connection or destructive statement.
  if (!isLoopbackHost(host)) {
    throw new Error(
      `Hard guard: refusing non-loopback host "${host}". test:integration may only run against a LOCAL Postgres.\n${GUARD_GUIDANCE}`,
    )
  }
  if (dbName !== TEST_DB_NAME) {
    throw new Error(
      `Hard guard: refusing database "${dbName}". Point DATABASE_URL at ${TEST_DB_NAME} (never the dev "clanker" db).`,
    )
  }
  return url.toString()
}

let readyPromise: Promise<void> | null = null

/** Preflight → CREATE DATABASE if absent → migrate once. Memoized per process. */
export const ensureIntegrationDatabase = (): Promise<void> => {
  if (!readyPromise) {
    readyPromise = (async () => {
      const testUrl = resolveTestUrl()
      const adminUrl = new URL(testUrl)
      adminUrl.pathname = '/postgres'

      const admin = new pg.Client({ connectionString: adminUrl.toString() })
      await admin.connect()
      try {
        await admin.query('SELECT 1') // unreachable-database fails HERE, once, loudly
        const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
          TEST_DB_NAME,
        ])
        if (existing.rowCount === 0) {
          await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`)
        }
      } finally {
        await admin.end()
      }

      // scripts/migrate-dev.mjs honors DATABASE_URL verbatim and is idempotent;
      // it refuses non-local hosts, so this can never touch Cloud SQL.
      const result = spawnSync('node', ['scripts/migrate-dev.mjs'], {
        env: { ...process.env, DATABASE_URL: testUrl },
        cwd: FUNCTIONS_ROOT,
        stdio: 'inherit',
      })
      if (result.status !== 0) {
        throw new Error(`migrate-dev.mjs failed with exit code ${result.status}; aborting.`)
      }
    })().catch((error) => {
      readyPromise = null
      throw error
    })
  }
  return readyPromise
}

let poolInstance: pg.Pool | null = null
export const getPool = (): pg.Pool => {
  if (!poolInstance) {
    poolInstance = new pg.Pool({ connectionString: resolveTestUrl(), max: 5 })
  }
  return poolInstance
}

type TestDb = NodePgDatabase<typeof schema>
let dbInstance: TestDb | null = null
/** Drop-in replacement for cloudSql getDb — hands the REAL services a test connection. */
export const testGetDb = async (): Promise<TestDb> => {
  if (!dbInstance) {
    dbInstance = drizzle(getPool(), { schema })
  }
  return dbInstance
}

export type UserRow = typeof schema.users.$inferSelect

export const seedUser = async (firebaseUid: string, email: string): Promise<UserRow> => {
  const db = await testGetDb()
  const [row] = await db.insert(schema.users).values({ firebaseUid, email }).returning()
  return row
}

/** TRUNCATE the five payment tables; CASCADE handles FK children, RESTART IDENTITY resets sequences. */
export const truncateAll = async (): Promise<void> => {
  await getPool().query(
    'TRUNCATE users, subscriptions, processed_stripe_events, credit_transactions, credit_spend_events RESTART IDENTITY CASCADE',
  )
}

export const closeIntegrationPool = async (): Promise<void> => {
  if (poolInstance) {
    await poolInstance.end()
    poolInstance = null
    dbInstance = null
  }
}
```

- [ ] **Step 7: Write `functions/src/integration/README.md`**

Content (verbatim intent, prose may be polished but MUST include these facts):

```markdown
# Payment webhook integration suite

Drives the real `stripeWebhookHandler` / `revenueCatWebhookHandler` cores over
genuine HTTP (genuinely-signed payloads) against a real local Postgres DB
named `clanker_test`. Fully offline: the Stripe REST client and the GA4
senders are the only fakes.

## Prerequisites

1. Docker Postgres from the repo root:
   docker compose -f docker-compose.local.yml up -d postgres_db
2. Point DATABASE_URL at the sibling TEST database (the suite creates and
   migrates it; it refuses to operate on the dev `clanker` db):
   export DATABASE_URL='postgres://clanker_dev:local_pass@localhost:5432/clanker_test'

## Run

npm --prefix functions run test:integration

Notes:

- Do NOT set NODE_ENV=test for this suite (cloudSql's test guard throws).
- Files run sequentially (--test-concurrency=1) because both truncate the
  same tables between tests.
- Dev `clanker` data is never touched; a hard name guard aborts otherwise.
```

- [ ] **Step 8: Compile-check both configs**

Run: `npm --prefix functions run build:int`
Expected: emits `lib-integration/integration/helpers/*.js`, exit 0.

Run: `npm --prefix functions run typecheck`
Expected: exit 0 (default config still clean with the added exclude).

- [ ] **Step 9: Prettier + commit (scaffolding commit)**

Run: `npx prettier --write functions/tsconfig.json functions/tsconfig.int.json functions/package.json functions/src/integration/**/*.{ts,md} functions/src/integration/README.md && npx prettier --check functions/src/integration functions/tsconfig.int.json`

```bash
git add functions/tsconfig.json functions/tsconfig.int.json functions/package.json functions/src/integration
git commit -m "chore(functions): scaffold payment webhook integration suite

Second tsconfig compiles src/integration to lib-integration (excluded from
the default build/test glob), plus db/http/signing helpers, README, and
build:int / test:integration scripts pinned to sequential execution.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Stripe integration suite — S1–S6, D1–D4

**Files:**

- Test: `functions/src/integration/stripeWebhook.int.test.ts`

**Interfaces:**

- Consumes: everything Task 2 produced (exact names above) plus `setStripeClientFactoryForTests` (`stripeWebhook.ts:256`), `stripeWebhookHandler` (:379), real services `createSubscriptionService`/`createCreditService`/`createStripeEventDedupeService`, per-call-overridable `userRepository`.
- Produces: nothing downstream.

Shared file skeleton (all rows below live inside it):

```ts
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import Stripe from 'stripe'
import { stripeWebhookHandler, setStripeClientFactoryForTests } from '../../stripeWebhook.js'
import { createSubscriptionService } from '../../services/subscriptionService.js'
import { createCreditService } from '../../services/creditService.js'
import { createStripeEventDedupeService } from '../../services/stripeEventDedupeService.js'
import { userRepository } from '../../services/userRepository.js'
import {
  ensureIntegrationDatabase,
  testGetDb,
  seedUser,
  truncateAll,
  closeIntegrationPool,
  getPool,
} from './helpers/db.js'
import {
  INT_STRIPE_SECRET,
  INT_PRICE_IDS,
  signedStripePost,
  signStripeHeader,
} from './helpers/signing.js'
import { startWebhookServer } from './helpers/httpHarness.js'

// Lazy-read env — safe despite ESM hoisting (handlers read secrets/prices per request).
process.env.STRIPE_WEBHOOK_SECRET = INT_STRIPE_SECRET
process.env.STRIPE_MONTHLY_20_PRICE_ID = INT_PRICE_IDS.monthly20
process.env.STRIPE_MONTHLY_50_PRICE_ID = INT_PRICE_IDS.monthly50
process.env.STRIPE_CREDIT_PACK_PRICE_ID = INT_PRICE_IDS.creditPack

before(async () => {
  await ensureIntegrationDatabase()
})
beforeEach(async () => {
  await truncateAll()
})
after(async () => {
  await closeIntegrationPool()
})

// Deterministic timestamps.
const PERIOD_END_SECS = Math.floor(Date.UTC(2027, 0, 1) / 1000)
const EXP_MS = Date.UTC(2027, 0, 1)

// Distinct synthetic emails — users.email carries a UNIQUE constraint, so every
// seeded user gets its own address. (Never reuse one literal across seeds.)
const EMAIL_S1 = 'stripe-s1@int.test'
const EMAIL_S2 = 'stripe-s2@int.test'
const EMAIL_S6A = 'stripe-s6a@int.test'
const EMAIL_S6B = 'stripe-s6b@int.test'
const EMAIL_S6C = 'stripe-s6c@int.test'

// Hung-run guard: EVERY test in this file is declared as
//   test('<name>', { timeout: 10_000 }, async () => { ... })
// The snippets below show only bodies for brevity; the options object is mandatory.

// REAL service instances over clanker_test — identical wiring to each file's
// defaultDeps, except the GA4 senders, which are recording no-ops.
const subsService = createSubscriptionService({ getDb: testGetDb })
const credits = createCreditService({ getDb: testGetDb })
const dedupe = createStripeEventDedupeService({ getDb: testGetDb })

interface Ga4Recorder<T> {
  calls: T[]
}
const recorder = <T>(): Ga4Recorder<T> & ((p: T) => Promise<void>) => {
  const r: { calls: T[] } = { calls: [] }
  const fn = async (p: T) => {
    r.calls.push(p)
  }
  return Object.assign(fn, r) as Ga4Recorder<T> & ((p: T) => Promise<void>)
}

const makeRealStripeDeps = () => {
  const purchase = recorder<Record<string, unknown>>()
  const refund = recorder<Record<string, unknown>>()
  const deps = {
    findUserByEmail: async (email: string) => {
      const u = await userRepository.findUserByEmail(email, { getDb: testGetDb })
      return u ? { id: u.id, email: u.email, firebaseUid: u.firebaseUid ?? undefined } : null
    },
    findUserByFirebaseUid: async (uid: string) => {
      const u = await userRepository.findUserByFirebaseUid(uid, { getDb: testGetDb })
      return u ? { id: u.id, email: u.email, firebaseUid: u.firebaseUid ?? undefined } : null
    },
    findUserByStripeCustomerId: async (customerId: string) => {
      const userId = await subsService.findUserIdByStripeCustomerId(customerId)
      if (!userId) return null
      const u = await userRepository.findUserById(userId, { getDb: testGetDb })
      return u ? { id: u.id, email: u.email, firebaseUid: u.firebaseUid ?? undefined } : null
    },
    upsertSubscription: (p: Parameters<typeof subsService.upsertSubscription>[0]) =>
      subsService.upsertSubscription(p),
    renewSubscriptionCredits: (id: string, amount: number, e: Date, r: string) =>
      credits.renewSubscriptionCredits(id, amount, e, r),
    addCredits: (
      id: string,
      amount: number,
      e: Date | null,
      t: 'one_time' | 'signup' | 'legacy',
      r?: string,
    ) => credits.addCredits(id, amount, e, t, r),
    adjustCredits: (id: string, delta: number, reason: string, r?: string) =>
      credits.adjustCredits(id, delta, reason, r),
    sendPurchaseEvent: purchase,
    sendRefundEvent: refund,
    isEventProcessed: (eventId: string) => dedupe.isEventProcessed(eventId),
    markEventProcessed: (eventId: string) => dedupe.markEventProcessed(eventId),
    completeEventProcessed: (eventId: string) => dedupe.completeEventProcessed(eventId),
    unmarkEventProcessed: (eventId: string) => dedupe.unmarkEventProcessed(eventId),
    expireProcessingClaim: (eventId: string) => dedupe.expireProcessingClaim(eventId),
    getLastProcessedChargeRefundTotal: (chargeId: string) =>
      credits.getLastProcessedChargeRefundTotal(chargeId),
  }
  return { deps, purchase, refund }
}

/** Fake Stripe client answering only the four post-verification REST calls. */
const makeFakeStripe = (overrides: {
  lineItems?: unknown[]
  subscription?: Record<string, unknown>
  invoice?: Record<string, unknown>
}): Stripe =>
  ({
    checkout: {
      sessions: {
        listLineItems: async () => ({
          data: overrides.lineItems ?? [
            { price: { id: INT_PRICE_IDS.monthly20 }, quantity: 1, amount_total: 20000 },
          ],
        }),
      },
    },
    subscriptions: {
      retrieve: async () =>
        overrides.subscription ?? { deleted: false, current_period_end: PERIOD_END_SECS },
    },
    customers: { retrieve: async () => ({ id: 'cus_int', metadata: {} }) },
    invoices: { retrieve: async () => overrides.invoice ?? { lines: { data: [] } } },
  }) as unknown as Stripe

const postStripeEvent = async (url: string, event: Record<string, unknown>) => {
  const response = await fetch(url, signedStripePost(JSON.stringify(event)))
  return { status: response.status, text: await response.text() }
}

const mountAndPost = async (deps: unknown, event: Record<string, unknown>) => {
  const server = await startWebhookServer((req, res) =>
    stripeWebhookHandler(req as never, res as never, deps as never),
  )
  try {
    return await postStripeEvent(server.url, event)
  } finally {
    await server.close()
  }
}

// Predicate-scoped assertion helpers (DB trigger auto-seeds a signup grant +
// a free subscriptions row per user — never assert absolute counts).
const countCreditRows = async (whereSql: string, params: unknown[] = []) => {
  const { rowCount } = await getPool().query(
    `SELECT 1 FROM credit_transactions WHERE ${whereSql}`,
    params,
  )
  return rowCount ?? 0
}
const expectNoPaymentWrites = async () => {
  for (const table of [
    'subscriptions',
    'processed_stripe_events',
    'credit_transactions',
    'credit_spend_events',
  ]) {
    const { rowCount } = await getPool().query(`SELECT 1 FROM ${table}`)
    assert.equal(rowCount, 0, `expected ${table} to be empty`)
  }
}
```

- [ ] **Step 1: S1 — happy-path checkout writes real rows**

```ts
test('S1: signed checkout.session.completed grants renewal credits and upserts the subscription', async () => {
  const user = await seedUser('uid_stripe_s1', 'stripe-s1@test.local')
  const { deps, purchase } = makeRealStripeDeps()
  setStripeClientFactoryForTests(() =>
    makeFakeStripe({
      lineItems: [{ price: { id: INT_PRICE_IDS.monthly20 }, quantity: 1, amount_total: 20000 }],
    }),
  )

  const event = {
    id: 'evt_s1',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_s1',
        customer_details: { email: 'stripe-s1@test.local' },
        customer_email: 'stripe-s1@test.local',
        client_reference_id: null,
        subscription: 'sub_s1',
        customer: 'cus_s1',
        amount_total: 20000,
        currency: 'usd',
      },
    },
  }

  try {
    const { status, text } = await mountAndPost(deps, event)
    assert.equal(status, 200)
    assert.deepEqual(JSON.parse(text), { received: true })

    const sub = await getPool().query(
      `SELECT plan_tier, plan_status, subscription_provider, stripe_subscription_id, stripe_customer_id, cancel_at_period_end
       FROM subscriptions WHERE user_id = $1`,
      [user.id],
    )
    assert.equal(sub.rows[0].plan_tier, 'monthly_20')
    assert.equal(sub.rows[0].plan_status, 'active')
    assert.equal(sub.rows[0].subscription_provider, 'stripe')
    assert.equal(sub.rows[0].stripe_subscription_id, 'sub_s1')
    assert.equal(sub.rows[0].stripe_customer_id, 'cus_s1')
    assert.equal(sub.rows[0].cancel_at_period_end, false)

    // Renewal grant: SUBSCRIPTION_RENEWAL_CREDIT_AMOUNT keyed by sub_<id>_<periodEnd>.
    const grants = await getPool().query(
      `SELECT delta, reason, transaction_type, reference_id, expires_at FROM credit_transactions
       WHERE user_id = $1 AND reference_id = $2`,
      [user.id, `sub_sub_s1_${PERIOD_END_SECS}`],
    )
    assert.equal(grants.rowCount, 1)
    assert.equal(grants.rows[0].delta, 30000)
    assert.equal(grants.rows[0].reason, 'subscription')
    assert.equal(grants.rows[0].transaction_type, 'subscription')

    const processed = await getPool().query(
      `SELECT status FROM processed_stripe_events WHERE event_id = 'evt_s1'`,
    )
    assert.equal(processed.rows[0].status, 'completed')

    // GA4 purchase events fire ONLY for credit-pack line items
    // (handleCheckoutCompleted pack branch, stripeWebhook.ts:603-638).
    // A subscription-only cart emits NONE.
    assert.equal(purchase.calls.length, 0)
  } finally {
    setStripeClientFactoryForTests(null)
  }
})
```

Add a second happy-path variant in the same step: credit-pack-only cart (`subscription: null`, single line item `{price: {id: INT_PRICE_IDS.creditPack}, quantity: 2, amount_total: 4000}`, session id `'cs_pack'`) asserting `addCredits` wrote `delta = 20000` (= 10000 × qty), `transaction_type = 'one_time'`, `reason = 'one_time'`, `reference_id = 'cs_pack'`, and `expires_at` within `[now + 30d, now + 32d]` (pack expiry is `now + 31d`; tolerance avoids flakes). Here the GA4 recorder MUST have exactly one call, pinned strictly to the verified emission shape (`stripeWebhook.ts:625-631`):

```ts
assert.deepEqual(purchase.calls[0], {
  firebaseUid: user.firebaseUid,
  transactionId: 'cs_pack',
  valueMinorUnits: 4000, // pack subtotal only, even in mixed carts
  currency: 'usd',
  paymentProvider: 'stripe',
})
```

- [ ] **Step 2: Run S1 and verify PASS**

Run: `npm --prefix functions run test:integration`
Expected: S1 rows PASS (this is also the first end-to-end proof that harness + db helper + signing all work together). If the database isn't up, the preflight error from `ensureIntegrationDatabase()` appears once with the compose command — start the container and rerun.

- [ ] **Step 3: S2 — replay is idempotent**

```ts
test('S2: replaying the same event id writes exactly one credit grant', async () => {
  const user = await seedUser('uid_stripe_s2', 'stripe-s2@test.local')
  const { deps } = makeRealStripeDeps()
  setStripeClientFactoryForTests(() => makeFakeStripe({}))

  const event = {
    id: 'evt_s2',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_s2',
        customer_details: { email: 'stripe-s2@test.local' },
        customer_email: null,
        client_reference_id: null,
        subscription: 'sub_s2',
        customer: 'cus_s2',
        amount_total: 20000,
        currency: 'usd',
      },
    },
  }

  try {
    const first = await mountAndPost(deps, event)
    assert.equal(first.status, 200)
    const second = await mountAndPost(deps, event) // fresh genuine signature, same bytes+id
    assert.equal(second.status, 200)
    assert.deepEqual(JSON.parse(second.text), { received: true }) // markEventProcessed short-circuit

    assert.equal(
      await countCreditRows("user_id = $1 AND transaction_type = 'subscription'", [user.id]),
      1,
    )
    const processed = await getPool().query(
      `SELECT count(*)::int AS n FROM processed_stripe_events WHERE event_id = 'evt_s2'`,
    )
    assert.equal(processed.rows[0].n, 1)
  } finally {
    setStripeClientFactoryForTests(null)
  }
})
```

- [ ] **Step 4: S3/S4/S5 — red-provable negatives, zero seeds**

```ts
test('S3: valid signature over tampered bytes is rejected with no writes', async () => {
  const original = JSON.stringify({
    id: 'evt_s3',
    type: 'checkout.session.completed',
    data: { object: {} },
  })
  const signed = signedStripePost(original)
  const tamperedBytes = original.replace('checkout.session.completed', 'charge.refunded')
  const server = await startWebhookServer((req, res) =>
    stripeWebhookHandler(req as never, res as never, makeRealStripeDeps().deps as never),
  )
  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: signed.headers,
      body: tamperedBytes,
    })
    assert.equal(response.status, 400)
  } finally {
    await server.close()
  }
  await expectNoPaymentWrites()
})

test('S4: missing and garbage signature headers are rejected with no writes', async () => {
  const body = JSON.stringify({ id: 'evt_s4', type: 'unhandled.event', data: { object: {} } })
  const server = await startWebhookServer((req, res) =>
    stripeWebhookHandler(req as never, res as never, makeRealStripeDeps().deps as never),
  )
  try {
    const missing = await fetch(server.url, { method: 'POST', body })
    assert.equal(missing.status, 400)
    const garbage = await fetch(server.url, {
      method: 'POST',
      headers: { 'stripe-signature': 'v1=deadbeef,t=1' },
      body,
    })
    assert.equal(garbage.status, 400)
  } finally {
    await server.close()
  }
  await expectNoPaymentWrites()
})

test('S5: well-signed malformed JSON yields a defined 4xx, no partial writes', async () => {
  const broken = '{"id":"evt_s5","type":"unhandled.event",' // truncated JSON
  const server = await startWebhookServer((req, res) =>
    stripeWebhookHandler(req as never, res as never, makeRealStripeDeps().deps as never),
  )
  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'stripe-signature': signStripeHeader(broken, INT_STRIPE_SECRET) },
      body: broken,
    })
    assert.ok(response.status >= 400 && response.status < 500)
  } finally {
    await server.close()
  }
  await expectNoPaymentWrites()
})
```

(S5 needs `signStripeHeader` imported from `./helpers/signing.js`.)

- [ ] **Step 5: Red-provability check for the signer (run once, then restore)**

Temporarily change `INT_STRIPE_SECRET` in `helpers/signing.ts` to `'whsec_wrong'` while leaving `process.env.STRIPE_WEBHOOK_SECRET` assigned from the OLD constant value literal `'whsec_int_test_123'` in this file — i.e., simulate a silently-wrong signer.

Run: `npm --prefix functions run test:integration`
Expected: S1 and S2 FAIL with 400 responses; S3 PASSES (tamper detection now vacuously satisfied — acceptable during this drill). Restore the constant immediately afterwards and re-run: all green. This proves the suite cannot pass with a broken signer.

- [ ] **Step 6: S6 — refund flows exercise the REAL clawback ledger**

```ts
test('S6a: partial pack refund deducts floor-proportional credits once', async () => {
  const user = await seedUser('uid_stripe_s6', 'stripe-s6@test.local')
  const { deps, refund } = makeRealStripeDeps()
  setStripeClientFactoryForTests(() => makeFakeStripe({}))

  const chargeEvent = (amountRefunded: number, eventId: string) => ({
    id: eventId,
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_s6',
        amount: 2000,
        amount_refunded: amountRefunded,
        currency: 'usd',
        invoice: null,
        billing_details: { email: 'stripe-s6@test.local' },
        metadata: { price_id: INT_PRICE_IDS.creditPack, quantity: '1' },
      },
    },
  })

  try {
    const first = await mountAndPost(deps, chargeEvent(1000, 'evt_s6a'))
    assert.equal(first.status, 200)
    assert.deepEqual(JSON.parse(first.text), { received: true })

    const deductions = await getPool().query(
      `SELECT delta, reason, reference_id FROM credit_transactions
       WHERE user_id = $1 AND reason = 'stripe_refund' ORDER BY reference_id`,
      [user.id],
    )
    assert.equal(deductions.rowCount, 1)
    assert.equal(deductions.rows[0].delta, -5000) // floor(10000 * 1000/2000)
    assert.equal(deductions.rows[0].reference_id, 'ch_s6_1000')

    assert.equal(refund.calls.length, 1)
    assert.equal(refund.calls[0].valueMinorUnits, 1000)
    assert.equal(refund.calls[0].transactionId, 'ch_s6_1000')
  } finally {
    setStripeClientFactoryForTests(null)
  }
})

test('S6b: second partial refund claws back only the delta via the real refund-total ledger', async () => {
  const user = await seedUser('uid_stripe_s6b', 'stripe-s6b@test.local')
  const { deps } = makeRealStripeDeps()
  setStripeClientFactoryForTests(() => makeFakeStripe({}))

  const chargeEvent = (amountRefunded: number, eventId: string) => ({
    id: eventId,
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_s6b',
        amount: 2000,
        amount_refunded: amountRefunded,
        currency: 'usd',
        invoice: null,
        billing_details: { email: 'stripe-s6b@test.local' },
        metadata: { price_id: INT_PRICE_IDS.creditPack, quantity: '1' },
      },
    },
  })

  try {
    await mountAndPost(deps, chargeEvent(1000, 'evt_s6b_1'))
    const second = await mountAndPost(deps, chargeEvent(2000, 'evt_s6b_2'))
    assert.equal(second.status, 200)

    const totals = await getPool().query(
      `SELECT coalesce(sum(delta), 0)::int AS total FROM credit_transactions
       WHERE user_id = $1 AND reason = 'stripe_refund'`,
      [user.id],
    )
    assert.equal(totals.rows[0].total, -10000) // −5000 then −5000; never double-clawed

    const refs = await getPool().query(
      `SELECT reference_id FROM credit_transactions
       WHERE user_id = $1 AND reason = 'stripe_refund' ORDER BY reference_id`,
      [user.id],
    )
    assert.deepEqual(
      refs.rows.map((r) => r.reference_id),
      ['ch_s6b_1000', 'ch_s6b_2000'],
    )
  } finally {
    setStripeClientFactoryForTests(null)
  }
})

test('S6c: full refund of a subscription charge downgrades to free/cancelled', async () => {
  const user = await seedUser('uid_stripe_s6c', 'stripe-s6c@test.local')
  const { deps, refund } = makeRealStripeDeps()
  setStripeClientFactoryForTests(() =>
    makeFakeStripe({
      invoice: {
        parent: { subscription_details: { subscription: 'sub_s6c' } },
        lines: { data: [] },
      },
    }),
  )

  const event = {
    id: 'evt_s6c',
    type: 'charge.refunded',
    data: {
      object: {
        id: 'ch_s6c',
        amount: 2000,
        amount_refunded: 2000,
        currency: 'usd',
        invoice: 'in_s6c',
        billing_details: { email: 'stripe-s6c@test.local' },
        metadata: {},
      },
    },
  }

  try {
    const { status } = await mountAndPost(deps, event)
    assert.equal(status, 200)

    const sub = await getPool().query(
      `SELECT plan_tier, plan_status, subscription_provider, cancel_at_period_end
       FROM subscriptions WHERE user_id = $1`,
      [user.id],
    )
    assert.equal(sub.rows[0].plan_tier, 'free')
    assert.equal(sub.rows[0].plan_status, 'cancelled')
    assert.equal(sub.rows[0].subscription_provider, null)
    assert.equal(sub.rows[0].cancel_at_period_end, false)

    assert.equal(refund.calls.length, 1)
    assert.equal(refund.calls[0].transactionId, 'ch_s6c')
  } finally {
    setStripeClientFactoryForTests(null)
  }
})
```

Note S6a/S6b use distinct charge ids per test so `getLastProcessedChargeRefundTotal`'s real LIKE-prefix scan sees only that test's rows.

- [ ] **Step 7: D1–D4 — dedupe leasing against real SQL comparisons**

```ts
test('D1/D2: fresh claim succeeds; second claim within the lease window is rejected', async () => {
  const claimed = await dedupe.markEventProcessed('evt_d1')
  assert.equal(claimed, true)
  const row = await getPool().query(
    `SELECT status FROM processed_stripe_events WHERE event_id = 'evt_d1'`,
  )
  assert.equal(row.rows[0].status, 'processing')
  assert.equal(await dedupe.markEventProcessed('evt_d1'), false)
})

test('D3: backdating the lease past 5 minutes allows takeover', async () => {
  await dedupe.markEventProcessed('evt_d3')
  assert.equal(await dedupe.markEventProcessed('evt_d3'), false)

  await getPool().query(
    `UPDATE processed_stripe_events SET created_at = now() - interval '6 minutes' WHERE event_id = $1`,
    ['evt_d3'],
  )
  assert.equal(await dedupe.markEventProcessed('evt_d3'), true) // real expiry comparison, as shipped
})

test('D4: complete blocks forever; unmark releases for a fresh claim', async () => {
  await dedupe.markEventProcessed('evt_d4')
  await dedupe.completeEventProcessed('evt_d4')
  assert.equal(await dedupe.isEventProcessed('evt_d4'), true)
  assert.equal(await dedupe.markEventProcessed('evt_d4'), false)

  await dedupe.unmarkEventProcessed('evt_d4')
  assert.equal(await dedupe.isEventProcessed('evt_d4'), false)
  assert.equal(await dedupe.markEventProcessed('evt_d4'), true)
})
```

(D3 uses SQL backdating per approved Decision 7 — no clock injection, no production change.)

- [ ] **Step 8: Run the whole Stripe file**

Run: `npm --prefix functions run test:integration`
Expected: all rows PASS (S1×2, S2, S3, S4, S5, S6a-c, D1-D2, D3, D4).

- [ ] **Step 9: Prettier + commit (suite commit)**

Run: `npx prettier --write functions/src/integration/stripeWebhook.int.test.ts && npx prettier --check functions/src/integration/stripeWebhook.int.test.ts`

```bash
git add functions/src/integration/stripeWebhook.int.test.ts
git commit -m "test(functions): Stripe webhook integration coverage (S1-S6, D1-D4)

Genuinely-signed deliveries over real HTTP; real service stack against
clanker_test; only the Stripe REST client and GA4 senders are fakes.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: RevenueCat integration suite — R1–R8

**Files:**

- Test: `functions/src/integration/revenueCatWebhook.int.test.ts`

**Interfaces:**

- Consumes: Task 2 helpers; `revenueCatWebhookHandler` (`revenueCatWebhook.ts:464`) with a FULL explicit deps object (its interface isn't exported — structural typing validates at the call site; `getOrCreateUserByFirebaseUid` is deliberately OMITTED everywhere: normal rows resolve via real `findUserByFirebaseUid`, R8 relies on omission ⇒ 503).
- Produces: nothing downstream.

File skeleton (same conventions as Task 3):

```ts
import { test, before, after, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { revenueCatWebhookHandler } from '../../revenueCatWebhook.js'
import { createSubscriptionService } from '../../services/subscriptionService.js'
import { createCreditService } from '../../services/creditService.js'
import { userRepository } from '../../services/userRepository.js'
import {
  ensureIntegrationDatabase,
  testGetDb,
  seedUser,
  truncateAll,
  closeIntegrationPool,
  getPool,
} from './helpers/db.js'
import { INT_RC_SECRET, rcAuthHeaders } from './helpers/signing.js'
import { startWebhookServer } from './helpers/httpHarness.js'

process.env.REVENUECAT_WEBHOOK_SECRET = INT_RC_SECRET

before(async () => {
  await ensureIntegrationDatabase()
})
beforeEach(async () => {
  await truncateAll()
})
after(async () => {
  await closeIntegrationPool()
})

const EXP_MS = Date.UTC(2027, 0, 1)

// Hung-run guard: EVERY test in this file is declared as
//   test('<name>', { timeout: 10_000 }, async () => { ... })
// The snippets below show only bodies for brevity; the options object is mandatory.

const subsService = createSubscriptionService({ getDb: testGetDb })
const credits = createCreditService({ getDb: testGetDb })

const makeRcDeps = () => {
  const purchaseCalls: Array<Record<string, unknown>> = []
  const refundCalls: Array<Record<string, unknown>> = []
  const deps = {
    // REAL lookup against clanker_test (mirrors defaultDeps :112-116).
    findUserByFirebaseUid: async (uid: string) => {
      const u = await userRepository.findUserByFirebaseUid(uid, { getDb: testGetDb })
      return u ? { id: u.id } : null
    },
    // getOrCreateUserByFirebaseUid intentionally omitted — never touches Firebase Auth.
    getSubscription: async (userId: string) => {
      const s = await subsService.getSubscription(userId)
      return s
        ? {
            planTier: s.planTier,
            planStatus: s.planStatus,
            subscriptionProvider: s.subscriptionProvider,
          }
        : null
    },
    // Mirrors defaultDeps :148-157 (renewalAt → billingCycleEnd).
    upsertSubscription: async (p: {
      userId: string
      planTier: 'free' | 'monthly_20' | 'monthly_50' | 'payg'
      planStatus: 'active' | 'cancelled' | 'expired'
      renewalAt?: Date | null
      subscriptionProvider?: 'stripe' | 'revenuecat' | null
      cancelAtPeriodEnd?: boolean
    }) =>
      subsService.upsertSubscription({
        userId: p.userId,
        planTier: p.planTier,
        planStatus: p.planStatus,
        billingCycleEnd: p.renewalAt ?? null,
        subscriptionProvider: p.subscriptionProvider ?? null,
        cancelAtPeriodEnd: p.cancelAtPeriodEnd,
      }),
    renewSubscriptionCredits: (id: string, amount: number, e: Date, r: string) =>
      credits.renewSubscriptionCredits(id, amount, e, r),
    addCredits: (
      id: string,
      amount: number,
      e: Date | null,
      t: 'one_time' | 'signup' | 'legacy',
      r?: string,
    ) => credits.addCredits(id, amount, e, t, r),
    adjustCredits: (id: string, delta: number, reason: string, r?: string) =>
      credits.adjustCredits(id, delta, reason, r),
    sendPurchaseEvent: async (p: Record<string, unknown>) => {
      purchaseCalls.push(p)
    },
    sendRefundEvent: async (p: Record<string, unknown>) => {
      refundCalls.push(p)
    },
  }
  return { deps, purchaseCalls, refundCalls }
}

const rcEvent = (fields: Record<string, unknown>) => ({
  event: { app_user_id: 'uid_rc', product_id: 'monthly_20_subscription', ...fields },
})

const mountAndPostRc = async (
  deps: unknown,
  body: Record<string, unknown>,
  form: 'bearer' | 'bare' = 'bearer',
) => {
  const server = await startWebhookServer((req, res) =>
    revenueCatWebhookHandler(req as never, res as never, deps as never),
  )
  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...rcAuthHeaders(form) },
      body: JSON.stringify(body),
    })
    return { status: response.status, text: await response.text() }
  } finally {
    await server.close()
  }
}

const expectNoPaymentWrites = async () => {
  for (const table of [
    'subscriptions',
    'processed_stripe_events',
    'credit_transactions',
    'credit_spend_events',
  ]) {
    const { rowCount } = await getPool().query(`SELECT 1 FROM ${table}`)
    assert.equal(rowCount, 0, `expected ${table} to be empty`)
  }
}
```

- [ ] **Step 1: R1/R2/R3 — auth contract and the live-mode happy path**

```ts
test('R1: bearer-authenticated INITIAL_PURCHASE upserts revenuecat sub + grants renewal credits', async () => {
  const user = await seedUser('uid_rc_r1', 'rc-r1@test.local')
  const { deps, purchaseCalls } = makeRcDeps()

  const { status, text } = await mountAndPostRc(
    deps,
    rcEvent({
      type: 'INITIAL_PURCHASE',
      app_user_id: 'uid_rc_r1',
      expiration_at_ms: EXP_MS,
      original_transaction_id: 'rc_r1_txn',
    }),
  )

  assert.equal(status, 200)
  assert.deepEqual(JSON.parse(text), { received: true })

  const sub = await getPool().query(
    `SELECT plan_tier, plan_status, subscription_provider, cancel_at_period_end, billing_cycle_end
     FROM subscriptions WHERE user_id = $1`,
    [user.id],
  )
  assert.equal(sub.rows[0].plan_tier, 'monthly_20')
  assert.equal(sub.rows[0].plan_status, 'active')
  assert.equal(sub.rows[0].subscription_provider, 'revenuecat')
  assert.equal(sub.rows[0].cancel_at_period_end, false)
  assert.equal(new Date(sub.rows[0].billing_cycle_end).getTime(), EXP_MS)

  const grant = await getPool().query(
    `SELECT delta, reason, transaction_type, reference_id FROM credit_transactions
     WHERE user_id = $1 AND reference_id = $2`,
    [user.id, `rc_r1_txn_${EXP_MS}`],
  )
  assert.equal(grant.rowCount, 1)
  assert.equal(grant.rows[0].delta, 30000)
  assert.equal(grant.rows[0].reason, 'subscription')

  assert.equal(purchaseCalls.length, 1)
  assert.equal(purchaseCalls[0].paymentProvider, 'revenuecat')
  assert.equal(purchaseCalls[0].transactionId, `rc_r1_txn_${EXP_MS}`) // resolveGa4TransactionId fallback
})

test('R2: wrong bearer is rejected 401 with zero DB writes (red-provable)', async () => {
  const server = await startWebhookServer((req, res) =>
    revenueCatWebhookHandler(req as never, res as never, makeRcDeps().deps as never),
  )
  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-secret' },
      body: JSON.stringify(rcEvent({ type: 'INITIAL_PURCHASE' })),
    })
    assert.equal(response.status, 401)
    assert.equal(await response.text(), 'Unauthorized')
  } finally {
    await server.close()
  }
  await expectNoPaymentWrites()
})

test('R3: bare-secret authorization form is accepted', async () => {
  await seedUser('uid_rc_r3', 'rc-r3@test.local')
  const { deps } = makeRcDeps()
  const { status } = await mountAndPostRc(
    deps,
    rcEvent({
      type: 'INITIAL_PURCHASE',
      app_user_id: 'uid_rc_r3',
      expiration_at_ms: EXP_MS,
      original_transaction_id: 'rc_r3_txn',
    }),
    'bare',
  )
  assert.equal(status, 200)
})
```

Red-provability drill for R2 (once, then restore): flip `INT_RC_SECRET` in `helpers/signing.ts` to a different constant than the one assigned to `process.env.REVENUECAT_WEBHOOK_SECRET` at the top of this file — R1/R3 must FAIL with 401 while R2 passes. Restore and re-run green.

- [ ] **Step 2: R4/R5 — short-circuits persist nothing**

```ts
test('R4: SANDBOX events ack with ignored:sandbox and persist nothing', async () => {
  const { deps } = makeRcDeps()
  const { status, text } = await mountAndPostRc(
    deps,
    rcEvent({ type: 'INITIAL_PURCHASE', environment: 'SANDBOX' }),
  )
  assert.equal(status, 200)
  assert.deepEqual(JSON.parse(text), { received: true, ignored: 'sandbox' })
  await expectNoPaymentWrites()
})

test('R5: TEST-type events are acknowledged and persist nothing', async () => {
  const { deps } = makeRcDeps()
  const { status, text } = await mountAndPostRc(deps, { event: { type: 'TEST' } })
  assert.equal(status, 200)
  assert.deepEqual(JSON.parse(text), { received: true })
  await expectNoPaymentWrites()
})
```

- [ ] **Step 3: R6 — stripe-collision path takes the DEFINED outcome**

Spec wording says "stripe row untouched", but the verified shipped behavior (`revenueCatWebhook.ts:592-627`) is: warn `billing_provider_collision`, THEN proceed with the upsert + credits anyway. Assert the actual behavior (row transitions to revenuecat, credits granted) — do NOT invent an "untouched" expectation the code doesn't have. Flag this spec-wording deviation in the PR description.

```ts
test('R6: active stripe collision warns-and-proceeds: row moves to revenuecat, credits granted', async () => {
  const user = await seedUser('uid_rc_r6', 'rc-r6@test.local')
  // Seed an active STRIPE subscription directly (upsert-safe whether or not the
  // handle_new_user trigger already created a free row).
  await subsService.upsertSubscription({
    userId: user.id,
    planTier: 'monthly_50',
    planStatus: 'active',
    subscriptionProvider: 'stripe',
  })
  const { deps } = makeRcDeps()

  const { status } = await mountAndPostRc(
    deps,
    rcEvent({
      type: 'INITIAL_PURCHASE',
      app_user_id: 'uid_rc_r6',
      expiration_at_ms: EXP_MS,
      original_transaction_id: 'rc_r6_txn',
    }),
  )
  assert.equal(status, 200)

  const sub = await getPool().query(
    `SELECT plan_tier, plan_status, subscription_provider FROM subscriptions WHERE user_id = $1`,
    [user.id],
  )
  assert.equal(sub.rows[0].subscription_provider, 'revenuecat') // defined outcome
  assert.equal(sub.rows[0].plan_tier, 'monthly_20')

  const grant = await getPool().query(
    `SELECT 1 FROM credit_transactions WHERE user_id = $1 AND reference_id = $2`,
    [user.id, `rc_r6_txn_${EXP_MS}`],
  )
  assert.equal(grant.rowCount, 1)
})
```

- [ ] **Step 4: R7/R8 — Android normalization and unresolved user**

```ts
test('R7: Android product id suffix is stripped before tier mapping', async () => {
  const user = await seedUser('uid_rc_r7', 'rc-r7@test.local')
  const { deps } = makeRcDeps()

  const { status } = await mountAndPostRc(
    deps,
    rcEvent({
      type: 'INITIAL_PURCHASE',
      app_user_id: 'uid_rc_r7',
      product_id: 'monthly_20_subscription:some-base-plan', // Android form
      expiration_at_ms: EXP_MS,
      original_transaction_id: 'rc_r7_txn',
    }),
  )
  assert.equal(status, 200)

  const sub = await getPool().query(
    `SELECT plan_tier, subscription_provider FROM subscriptions WHERE user_id = $1`,
    [user.id],
  )
  assert.equal(sub.rows[0].plan_tier, 'monthly_20') // normalized, suffix gone
  assert.equal(sub.rows[0].subscription_provider, 'revenuecat')
})

test('R8: unknown user with no bootstrap dep resolves 503 and creates no orphan rows', async () => {
  const { deps } = makeRcDeps() // findUserByFirebaseUid → real lookup → null; no getOrCreate provided
  const { status, text } = await mountAndPostRc(
    deps,
    rcEvent({
      type: 'INITIAL_PURCHASE',
      app_user_id: 'uid_nobody',
      expiration_at_ms: EXP_MS,
      original_transaction_id: 'rc_r8_txn',
    }),
  )
  assert.equal(status, 503)
  assert.deepEqual(JSON.parse(text), { received: false, error: 'Cloud SQL user not ready' })

  const users = await getPool().query('SELECT 1 FROM users')
  assert.equal(users.rowCount, 0)
  await expectNoPaymentWrites()
})
```

- [ ] **Step 5: Run the whole suite**

Run: `npm --prefix functions run test:integration`
Expected baseline: 13 pass / 7 fail — the 7 failures are the known out-of-scope
`creditService.syncSubscriptionCache` production defect; any OTHER failure is a regression.
Stripe file (Task 3) + RC file, executed sequentially.

- [ ] **Step 6: Prettier + commit (suite commit)**

Run: `npx prettier --write functions/src/integration/revenueCatWebhook.int.test.ts && npx prettier --check functions/src/integration/revenueCatWebhook.int.test.ts`

```bash
git add functions/src/integration/revenueCatWebhook.int.test.ts
git commit -m "test(functions): RevenueCat webhook integration coverage (R1-R8)

Bearer/bare auth, sandbox/TEST short-circuits, stripe-collision outcome,
Android product-id normalization, unresolved-user 503 — real deps against
clanker_test, Firebase Auth lookup omitted by design.

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Acceptance sweep (no commit unless something needs fixing)

- [ ] **Step 1: Integration suite end-to-end from a clean shell**

```bash
docker compose -f docker-compose.local.yml up -d postgres_db
export DATABASE_URL='postgres://clanker_dev:local_pass@localhost:5432/clanker_test'
npm --prefix functions run test:integration
```

Expected: matches the documented 13/7 baseline (only the known syncSubscriptionCache failures); clean process exit (pool drained in `after`).

- [ ] **Step 2: Default suite unchanged**

Run: `npm --prefix functions test`
Expected: 470/470 (or honest current baseline). Confirm `lib/` contains NO `*.int.test.js` (`find functions/lib -name '*.int.test.js'` → empty).

- [ ] **Step 3: Both tsc configs clean**

Run: `npm --prefix functions run typecheck && npm --prefix functions run typecheck:int`
Expected: exit 0 twice.

- [ ] **Step 4: Lint + format gates**

Run: `npm --prefix functions run lint` and `npx prettier --check functions/src/integration functions/tsconfig.int.json functions/package.json functions/tsconfig.json functions/src/stripeWebhook.test.ts`
Expected: clean. Fix any finding in a FORMATTING-ONLY follow-up commit if it touches logic files; inline fix is fine for files this branch created.

- [ ] **Step 5: Report**

Summarize: commits landed, test counts (integration N/N, default baseline), any deviations flagged (R6 wording), and stop — the user opens the staging PR explicitly.

---

## Spec-coverage crosswalk (for self-review)

| Spec requirement                                               | Task/Step                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Genuine HMAC signatures, no constructEvent stubbing (Dec 2, 9) | Task 1; Task 3 Step 5 drill                                                  |
| Neutralize exactly two outbound surfaces (Dec 3)               | `makeFakeStripe` (factory seam), recording GA4 no-ops (both suites)          |
| node:http shim fallback (Deferral 1)                           | Task 2 Step 5 (Express confirmed ABSENT from functions deps — shim applies)  |
| clanker_test sibling DB + migrate-once + truncation (Dec 5)    | Task 2 Step 6; `beforeEach(truncateAll)`                                     |
| loopback + db-name hard guard                                  | `resolveTestUrl()` throws on non-loopback host or non-`clanker_test` db                                      |
| Separate tsconfig/scripts; default suite untouched (Dec 6)     | Task 2 Steps 1–3; Task 5 Step 2                                              |
| DATABASE_URL fail-fast with copyable commands                  | `requiredTestUrl()`                                                          |
| Lease expiry via SQL backdate (Dec 7)                          | Task 3 Step 7 D3                                                             |
| RC Auth lookup injected, not mock-admin (Dec 8)                | `makeRcDeps` omits `getOrCreateUserByFirebaseUid`                            |
| Matrix S1–S6/D1–D4                                             | Task 3 Steps 1,3,4,6,7                                                       |
| Matrix R1–R8                                                   | Task 4 Steps 1–4                                                             |
| Red-provable negatives S3,S4,R2                                | Those tests + drills (Steps 5/1 respectively)                                |
| Per-test timeout ~10s                                          | Add `timeout: 10_000` option object to each `test(...)` call in Tasks 3–4    |
| Hung-run protection: drain pool, close servers                 | `after(closeIntegrationPool)`; `finally { await server.close() }` everywhere |
| Commit sequence ①②③④, no formatting/logic mixing               | Tasks 1–4 commit steps                                                       |
| No new migrations, no CI wiring, no prod changes               | Global Constraints; nothing in tasks touches either                          |
