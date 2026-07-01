# Billing Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 6 fixes in `docs/superpowers/specs/2026-07-01-billing-hardening-design.md` — cross-platform subscription collision handling, RevenueCat credit-pack double-grant guard, Stripe partial-refund proration, Stripe customer lookup fallback, Stripe event-level idempotency, and a `cancel_at_period_end` signal.

**Architecture:** Two new `subscriptions` columns (`subscription_provider`, `cancel_at_period_end`) and one new dedupe table (`processed_stripe_events`), threaded through `subscriptionService`, both webhook handlers, `purchasePackageStripe`, and (for `cancel_at_period_end` only) the client bootstrap payload. No changes to the credit ledger, `spendCredits`, or `syncSubscriptionCache`.

**Tech Stack:** Firebase Functions (Node/TypeScript), Drizzle ORM, Postgres (Cloud SQL), `node:test` for functions tests, Jest for client tests, Expo Router / React Native client.

---

## Before You Start

Read `docs/superpowers/specs/2026-07-01-billing-hardening-design.md` in full — every task below implements a specific section of it. Run `cd functions && npm run build && npm test` once before starting to confirm a clean baseline.

---

### Task 1: Schema — new columns and dedupe table

**Files:**
- Modify: `functions/src/db/schema.ts:30-50` (subscriptions table)
- Modify: `functions/src/db/schema.ts` (add new table export, anywhere after `subscriptions`)
- Create: `functions/drizzle/0018_billing_hardening.sql`
- Create: `functions/src/db/billingHardeningMigration.test.ts`

- [ ] **Step 1: Add the two new columns + check constraint to the `subscriptions` table definition**

In `functions/src/db/schema.ts`, the `subscriptions` table currently ends:

```typescript
  documentsIngestedCount: integer('documents_ingested_count').notNull().default(0),
  documentsIngestedDate: text('documents_ingested_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  planTierCheck: check('plan_tier_check', sql`${table.planTier} IN ('free', 'monthly_20', 'monthly_50', 'payg')`),
  planStatusCheck: check('plan_status_check', sql`${table.planStatus} IN ('active', 'cancelled', 'expired')`),
}));
```

Change it to:

```typescript
  documentsIngestedCount: integer('documents_ingested_count').notNull().default(0),
  documentsIngestedDate: text('documents_ingested_date'),
  subscriptionProvider: text('subscription_provider'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  planTierCheck: check('plan_tier_check', sql`${table.planTier} IN ('free', 'monthly_20', 'monthly_50', 'payg')`),
  planStatusCheck: check('plan_status_check', sql`${table.planStatus} IN ('active', 'cancelled', 'expired')`),
  subscriptionProviderCheck: check('subscription_provider_check', sql`${table.subscriptionProvider} IN ('stripe', 'revenuecat')`),
}));
```

(A Postgres `CHECK` on a nullable column with `IN (...)` is automatically satisfied when the column is `NULL` — no `IS NULL OR` needed.)

- [ ] **Step 2: Add the `processedStripeEvents` table**

Directly below the `subscriptions` table definition (before `creditTransactions`), add:

```typescript
export const processedStripeEvents = pgTable('processed_stripe_events', {
  eventId: text('event_id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3: Write the migration file**

Create `functions/drizzle/0018_billing_hardening.sql`:

```sql
ALTER TABLE "subscriptions" ADD COLUMN "subscription_provider" text;
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscription_provider_check" CHECK ("subscription_provider" IN ('stripe', 'revenuecat'));

CREATE TABLE "processed_stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

This is hand-written, not `drizzle-kit generate` — the project's migration journal is out of sync with hand-applied history (see `functions/drizzle/0017_expo_push_token.sql` for the same one-line-ALTER convention). Do not run `drizzle-kit generate` or touch `functions/drizzle/meta/_journal.json`.

- [ ] **Step 4: Write a migration-content test**

Create `functions/src/db/billingHardeningMigration.test.ts` (mirrors the existing pattern in `functions/src/db/migrationUsersTimestamps.test.ts`):

```typescript
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const migrationPath = path.resolve(process.cwd(), "drizzle/0018_billing_hardening.sql");

test("0018 migration adds subscription_provider, cancel_at_period_end, and processed_stripe_events", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /ADD COLUMN "subscription_provider" text;/);
  assert.match(sql, /ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;/);
  assert.match(sql, /ADD CONSTRAINT "subscription_provider_check" CHECK \("subscription_provider" IN \('stripe', 'revenuecat'\)\);/);
  assert.match(sql, /CREATE TABLE "processed_stripe_events"/);
  assert.match(sql, /"event_id" text PRIMARY KEY NOT NULL/);
});
```

- [ ] **Step 5: Run the test suite and typecheck**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="0018 migration"`
Expected: PASS

Run: `cd functions && npm run typecheck`
Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add functions/src/db/schema.ts functions/drizzle/0018_billing_hardening.sql functions/src/db/billingHardeningMigration.test.ts
git commit -m "feat(billing): add subscription_provider, cancel_at_period_end, processed_stripe_events"
```

---

### Task 2: `processed_stripe_events` dedupe service

**Files:**
- Create: `functions/src/services/stripeEventDedupeService.ts`
- Create: `functions/src/services/stripeEventDedupeService.test.ts`

- [ ] **Step 1: Write the failing test**

Create `functions/src/services/stripeEventDedupeService.test.ts`:

```typescript
import assert from 'node:assert/strict';
import test from 'node:test';
import { createStripeEventDedupeService } from './stripeEventDedupeService.js';

test('markEventProcessed returns true on first insert, false on duplicate', async () => {
  const inserted = new Set<string>();

  const fakeDb = {
    insert: () => ({
      values: (values: { eventId: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (inserted.has(values.eventId)) {
              return [];
            }
            inserted.add(values.eventId);
            return [{ eventId: values.eventId }];
          },
        }),
      }),
    }),
    delete: () => ({ where: async () => {} }),
  };

  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });

  assert.equal(await service.markEventProcessed('evt_1'), true);
  assert.equal(await service.markEventProcessed('evt_1'), false);
  assert.equal(await service.markEventProcessed('evt_2'), true);
});

test('unmarkEventProcessed deletes the row', async () => {
  let deletedEventId: string | null = null;

  const fakeDb = {
    delete: () => ({
      where: async () => {
        deletedEventId = 'evt_1';
      },
    }),
  };

  const service = createStripeEventDedupeService({ getDb: async () => fakeDb as never });
  await service.unmarkEventProcessed('evt_1');

  assert.equal(deletedEventId, 'evt_1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run build 2>&1 | head -30`
Expected: FAIL — `Cannot find module './stripeEventDedupeService.js'`

- [ ] **Step 3: Write the implementation**

Create `functions/src/services/stripeEventDedupeService.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { getDb } from '../db/cloudSql.js';
import { processedStripeEvents } from '../db/schema.js';

interface StripeEventDedupeServiceDeps {
  getDb: typeof getDb;
}

export const createStripeEventDedupeService = (
  deps: StripeEventDedupeServiceDeps = { getDb },
) => {
  return {
    /** Returns true if this call inserted the row (i.e. the event is new). */
    async markEventProcessed(eventId: string): Promise<boolean> {
      const db = await deps.getDb();
      const inserted = await db
        .insert(processedStripeEvents)
        .values({ eventId })
        .onConflictDoNothing()
        .returning({ eventId: processedStripeEvents.eventId });
      return inserted.length > 0;
    },

    /** Called when handler dispatch throws, so a legitimate Stripe retry isn't swallowed. */
    async unmarkEventProcessed(eventId: string): Promise<void> {
      const db = await deps.getDb();
      await db.delete(processedStripeEvents).where(eq(processedStripeEvents.eventId, eventId));
    },
  };
};

export const stripeEventDedupeService = createStripeEventDedupeService();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="markEventProcessed|unmarkEventProcessed"`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/stripeEventDedupeService.ts functions/src/services/stripeEventDedupeService.test.ts
git commit -m "feat(billing): add processed_stripe_events dedupe service"
```

---

### Task 3: `subscriptionService` — provider, cancel-at-period-end, and Stripe customer lookup

**Files:**
- Modify: `functions/src/services/subscriptionService.ts`
- Modify: `functions/src/services/subscriptionService.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/src/services/subscriptionService.test.ts` (after the existing tests, before nothing else needed):

```typescript
test('upsertSubscription writes subscriptionProvider and cancelAtPeriodEnd on insert and update', async () => {
  let insertValues: Record<string, unknown> | null = null;
  let updateSet: Record<string, unknown> | null = null;

  const fakeDb = {
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertValues = values;
        return {
          onConflictDoUpdate: (args: { set: Record<string, unknown> }) => {
            updateSet = args.set;
            return {
              returning: async () => [{ ...values, ...args.set }],
            };
          },
        };
      },
    }),
  };

  const service = createSubscriptionService({ getDb: async () => fakeDb as never });

  await service.upsertSubscription({
    userId: 'user-1',
    planTier: 'monthly_20',
    planStatus: 'active',
    subscriptionProvider: 'stripe',
    cancelAtPeriodEnd: true,
  });

  assert.equal((insertValues as { subscriptionProvider?: unknown } | null)?.subscriptionProvider, 'stripe');
  assert.equal((insertValues as { cancelAtPeriodEnd?: unknown } | null)?.cancelAtPeriodEnd, true);
  assert.equal((updateSet as { subscriptionProvider?: unknown } | null)?.subscriptionProvider, 'stripe');
  assert.equal((updateSet as { cancelAtPeriodEnd?: unknown } | null)?.cancelAtPeriodEnd, true);
});

test('upsertSubscription passing null for subscriptionProvider clears it on update', async () => {
  let updateSet: Record<string, unknown> | null = null;

  const fakeDb = {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (args: { set: Record<string, unknown> }) => {
          updateSet = args.set;
          return { returning: async () => [{ ...values, ...args.set }] };
        },
      }),
    }),
  };

  const service = createSubscriptionService({ getDb: async () => fakeDb as never });

  await service.upsertSubscription({
    userId: 'user-1',
    planTier: 'free',
    planStatus: 'cancelled',
    subscriptionProvider: null,
  });

  assert.equal((updateSet as { subscriptionProvider?: unknown } | null)?.subscriptionProvider, null);
});

test('findUserIdByStripeCustomerId returns the matching userId', async () => {
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ userId: 'user-42' }],
        }),
      }),
    }),
  };

  const service = createSubscriptionService({ getDb: async () => fakeDb as never });
  const userId = await service.findUserIdByStripeCustomerId('cus_123');

  assert.equal(userId, 'user-42');
});

test('findUserIdByStripeCustomerId returns null when no match', async () => {
  const fakeDb = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [],
        }),
      }),
    }),
  };

  const service = createSubscriptionService({ getDb: async () => fakeDb as never });
  const userId = await service.findUserIdByStripeCustomerId('cus_missing');

  assert.equal(userId, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="subscriptionProvider|findUserIdByStripeCustomerId"`
Expected: FAIL — `subscriptionProvider` undefined in insert/update values; `findUserIdByStripeCustomerId is not a function`

- [ ] **Step 3: Extend `UpsertSubscriptionParams` and `upsertSubscription`**

In `functions/src/services/subscriptionService.ts`, change the interface:

```typescript
export interface UpsertSubscriptionParams {
  userId: string;
  planTier: 'free' | 'monthly_20' | 'monthly_50' | 'payg';
  planStatus: 'active' | 'cancelled' | 'expired';
  currentCredits?: number;
  stripeSubscriptionId?: string | null;
  stripeCustomerId?: string | null;
  billingCycleStart?: Date | null;
  billingCycleEnd?: Date | null;
  subscriptionProvider?: 'stripe' | 'revenuecat' | null;
  cancelAtPeriodEnd?: boolean;
}
```

Change `upsertSubscription`:

```typescript
    async upsertSubscription(params: UpsertSubscriptionParams) {
      const db = await deps.getDb();
      const [upserted] = await db
        .insert(subscriptions)
        .values({
          userId: params.userId,
          planTier: params.planTier,
          planStatus: params.planStatus,
          currentCredits: params.currentCredits ?? 50,
          stripeSubscriptionId: params.stripeSubscriptionId,
          stripeCustomerId: params.stripeCustomerId,
          billingCycleStart: params.billingCycleStart,
          billingCycleEnd: params.billingCycleEnd,
          subscriptionProvider: params.subscriptionProvider,
          cancelAtPeriodEnd: params.cancelAtPeriodEnd ?? false,
        })
        .onConflictDoUpdate({
          target: subscriptions.userId,
          set: {
            planTier: params.planTier,
            planStatus: params.planStatus,
            currentCredits: params.currentCredits ?? sql`${subscriptions.currentCredits}`,
            stripeSubscriptionId: params.stripeSubscriptionId !== undefined ? params.stripeSubscriptionId : sql`${subscriptions.stripeSubscriptionId}`,
            stripeCustomerId: params.stripeCustomerId !== undefined ? params.stripeCustomerId : sql`${subscriptions.stripeCustomerId}`,
            billingCycleStart: params.billingCycleStart !== undefined ? params.billingCycleStart : sql`${subscriptions.billingCycleStart}`,
            billingCycleEnd: params.billingCycleEnd !== undefined ? params.billingCycleEnd : sql`${subscriptions.billingCycleEnd}`,
            subscriptionProvider: params.subscriptionProvider !== undefined ? params.subscriptionProvider : sql`${subscriptions.subscriptionProvider}`,
            cancelAtPeriodEnd: params.cancelAtPeriodEnd !== undefined ? params.cancelAtPeriodEnd : sql`${subscriptions.cancelAtPeriodEnd}`,
            updatedAt: new Date(),
          }
        })
        .returning();
      return upserted;
    },
```

- [ ] **Step 4: Add `findUserIdByStripeCustomerId`**

In the same file, add `eq` to the existing `drizzle-orm` import (it's already imported per the file's current `import { eq, sql } from 'drizzle-orm';`), and add a new method to the `service` object (after `upsertSubscription`, before `acceptTerms`):

```typescript
    async findUserIdByStripeCustomerId(stripeCustomerId: string): Promise<string | null> {
      const db = await deps.getDb();
      const result = await db
        .select({ userId: subscriptions.userId })
        .from(subscriptions)
        .where(eq(subscriptions.stripeCustomerId, stripeCustomerId))
        .limit(1);
      return result[0]?.userId ?? null;
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="subscriptionProvider|findUserIdByStripeCustomerId"`
Expected: PASS (4 new tests)

Run: `cd functions && npm test -- --test-name-pattern="upsertSubscription|getOrCreateDefaultSubscription"`
Expected: PASS (existing 3 tests still pass — unaffected, since the new fields are optional)

- [ ] **Step 6: Commit**

```bash
git add functions/src/services/subscriptionService.ts functions/src/services/subscriptionService.test.ts
git commit -m "feat(billing): subscriptionService supports provider, cancelAtPeriodEnd, customer-id lookup"
```

---

### Task 4: Stripe webhook — event-level idempotency (Fix #5)

**Files:**
- Modify: `functions/src/stripeWebhook.ts`
- Modify: `functions/src/stripeWebhook.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/src/stripeWebhook.test.ts`. First, note the existing tests construct real Stripe signatures nowhere near the dedupe guard (they test signature failure before reaching it), so add these as new tests using a valid stubbed `constructEvent` path. Since `stripeWebhookHandler` calls `stripe.webhooks.constructEvent` internally (not injectable), the cleanest way to test the dedupe guard is via `t.mock.method` on the `Stripe` prototype the same way `purchasePackageStripe.test.ts` does. Add:

```typescript
import test, {TestContext} from "node:test";
```

(replace the existing plain `import test from "node:test";` at the top of the file with the above, since we now need `TestContext` for `t.mock`).

Then add these tests at the end of the file:

```typescript
function stubConstructEvent(t: TestContext, event: Stripe.Event) {
  const stripeProto = Object.getPrototypeOf(new Stripe("sk_test_123").webhooks);
  t.mock.method(stripeProto, "constructEvent", () => event as never);
}

test("stripeWebhookHandler skips dispatch and returns 200 for an already-processed event", async (t) => {
  const res = createResponseRecorder();
  const event = {
    id: "evt_dup_1",
    type: "customer.subscription.deleted",
    data: {object: {id: "sub_1", customer: "cus_1"}},
  } as unknown as Stripe.Event;
  stubConstructEvent(t, event);

  let dispatched = false;
  const deps = {
    findUserByEmail: async () => { dispatched = true; return null; },
    findUserByFirebaseUid: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    markEventProcessed: async () => false,
    unmarkEventProcessed: async () => {},
  };

  await stripeWebhookHandler(
    {method: "POST", headers: {"stripe-signature": "t=1,v1=sig"}, rawBody: Buffer.from("{}")} as never,
    res as never,
    deps as never
  );

  assert.equal(res.statusCode, 200);
  assert.equal(dispatched, false);
});

test("stripeWebhookHandler unmarks the event when handler dispatch throws, so Stripe can retry", async (t) => {
  const res = createResponseRecorder();
  const event = {
    id: "evt_fail_1",
    type: "customer.subscription.deleted",
    data: {object: {id: "sub_1", customer: "cus_1"}},
  } as unknown as Stripe.Event;
  stubConstructEvent(t, event);

  let unmarkedEventId: string | null = null;
  const stripeProto = Object.getPrototypeOf(new Stripe("sk_test_123").customers);
  t.mock.method(stripeProto, "retrieve", async () => { throw new Error("Cloud SQL unavailable"); });

  const deps = {
    findUserByEmail: async () => null,
    findUserByFirebaseUid: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
    markEventProcessed: async () => true,
    unmarkEventProcessed: async (eventId: string) => { unmarkedEventId = eventId; },
  };

  await stripeWebhookHandler(
    {method: "POST", headers: {"stripe-signature": "t=1,v1=sig"}, rawBody: Buffer.from("{}")} as never,
    res as never,
    deps as never
  );

  assert.equal(res.statusCode, 500);
  assert.equal(unmarkedEventId, "evt_fail_1");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="already-processed|unmarks the event"`
Expected: FAIL — `deps.markEventProcessed is not a function` (property doesn't exist yet on the handler's deps type, and the guard isn't wired in yet — build may also fail on the `TestContext` import if unused elsewhere; that's expected until Step 3)

- [ ] **Step 3: Add the dedupe guard to `stripeWebhookHandler`**

In `functions/src/stripeWebhook.ts`, add the import:

```typescript
import {stripeEventDedupeService} from "./services/stripeEventDedupeService.js";
```

Extend `StripeWebhookDeps`:

```typescript
interface StripeWebhookDeps {
  findUserByEmail: (email: string) => Promise<UserLookup | null>;
  findUserByFirebaseUid: (firebaseUid: string) => Promise<UserLookup | null>;
  findUserByStripeCustomerId: (customerId: string) => Promise<UserLookup | null>;
  upsertSubscription: (params: UpsertSubscriptionParams) => Promise<void>;
  renewSubscriptionCredits: (userId: string, amount: number, expiresAt: Date, referenceId: string) => Promise<boolean>;
  addCredits: (userId: string, amount: number, expiresAt: Date | null, transactionType: 'one_time' | 'signup' | 'legacy', referenceId?: string) => Promise<void>;
  adjustCredits: (userId: string, delta: number, reason: string, referenceId?: string) => Promise<void>;
  markEventProcessed: (eventId: string) => Promise<boolean>;
  unmarkEventProcessed: (eventId: string) => Promise<void>;
}
```

(`findUserByStripeCustomerId` is added here too — it's used by Task 5, declaring it now avoids touching this interface twice.)

Extend `defaultDeps`:

```typescript
const defaultDeps: StripeWebhookDeps = {
  async findUserByEmail(email: string) {
    const user = await userRepository.findUserByEmail(email);
    if (!user) {
      return null;
    }
    return {id: user.id, email: user.email};
  },
  async findUserByFirebaseUid(firebaseUid: string) {
    const user = await userRepository.findUserByFirebaseUid(firebaseUid);
    if (!user) {
      return null;
    }
    return {id: user.id, email: user.email};
  },
  async findUserByStripeCustomerId(customerId: string) {
    const userId = await subscriptionService.findUserIdByStripeCustomerId(customerId);
    if (!userId) {
      return null;
    }
    const user = await userRepository.findUserById(userId);
    if (!user) {
      return null;
    }
    return {id: user.id, email: user.email};
  },
  async upsertSubscription(params: UpsertSubscriptionParams) {
    await subscriptionService.upsertSubscription(params);
  },
  async renewSubscriptionCredits(userId: string, amount: number, expiresAt: Date, referenceId: string) {
    return creditService.renewSubscriptionCredits(userId, amount, expiresAt, referenceId);
  },
  async addCredits(userId: string, amount: number, expiresAt: Date | null, transactionType: 'one_time' | 'signup' | 'legacy', referenceId?: string) {
    await creditService.addCredits(userId, amount, expiresAt, transactionType, referenceId);
  },
  async adjustCredits(userId: string, delta: number, reason: string, referenceId?: string) {
    await creditService.adjustCredits(userId, delta, reason, referenceId);
  },
  async markEventProcessed(eventId: string) {
    return stripeEventDedupeService.markEventProcessed(eventId);
  },
  async unmarkEventProcessed(eventId: string) {
    await stripeEventDedupeService.unmarkEventProcessed(eventId);
  },
};
```

Change the body of `stripeWebhookHandler` from:

```typescript
  logger.info("Received Stripe event", {type: event.type, id: event.id});

  try {
    const priceIds = getRequiredStripePriceIds();

    switch (event.type) {
    ...
    default:
      logger.info("Unhandled Stripe event type", {type: event.type});
    }

    res.status(200).json({received: true});
  } catch (err) {
    logger.error("Error processing Stripe webhook", {err, eventType: event.type});
    // Return a non-2xx status for unexpected processing failures so Stripe retries.
    res.status(500).json({received: false, error: "Processing error logged"});
  }
};
```

to:

```typescript
  logger.info("Received Stripe event", {type: event.type, id: event.id});

  const isNewEvent = await deps.markEventProcessed(event.id);
  if (!isNewEvent) {
    logger.info("Stripe event already processed, skipping", {type: event.type, id: event.id});
    res.status(200).json({received: true});
    return;
  }

  try {
    const priceIds = getRequiredStripePriceIds();

    switch (event.type) {
    ...
    default:
      logger.info("Unhandled Stripe event type", {type: event.type});
    }

    res.status(200).json({received: true});
  } catch (err) {
    await deps.unmarkEventProcessed(event.id);
    logger.error("Error processing Stripe webhook", {err, eventType: event.type});
    // Return a non-2xx status for unexpected processing failures so Stripe retries.
    res.status(500).json({received: false, error: "Processing error logged"});
  }
};
```

(Only the `try`/`catch` wrapper and the new guard change — the `switch` body's cases are untouched here; they change in later tasks.)

Note: `deps.markEventProcessed(event.id)` runs *outside* the `try`/`catch`, by design — if the dedupe insert itself throws (e.g. a transient Cloud SQL blip), the error propagates uncaught, which Express/Firebase Functions turns into an unhandled rejection → 500 response, so Stripe still retries. The only cost is that this specific failure mode skips the handler's own `logger.error` call and structured `{received: false, ...}` body. Accepted tradeoff — not worth wrapping in a second try/catch for a rare, already-retried failure path.

- [ ] **Step 4: Update every existing test's deps object to include the two new dependencies**

Every existing test in `functions/src/stripeWebhook.test.ts` that constructs a deps object (search for `adjustCredits: async () => {},` — there are 3 occurrences per the file as read) needs two more lines added directly after `adjustCredits`:

```typescript
    adjustCredits: async () => {},
    markEventProcessed: async () => true,
    unmarkEventProcessed: async () => {},
```

Also add `findUserByStripeCustomerId: async () => null,` directly after each existing `findUserByFirebaseUid: async () => null,` line in those same deps objects (3 occurrences).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npm run build && npm test`
Expected: all `stripeWebhook.test.ts` tests PASS, including the 2 new ones

- [ ] **Step 6: Commit**

```bash
git add functions/src/stripeWebhook.ts functions/src/stripeWebhook.test.ts
git commit -m "feat(billing): add Stripe webhook event-level idempotency guard"
```

---

### Task 5: Stripe webhook — customer lookup fallback chain (Fix #4)

**Files:**
- Modify: `functions/src/stripeWebhook.ts` (`handleSubscriptionUpdated`, `handleSubscriptionDeleted`)
- Modify: `functions/src/stripeWebhook.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/src/stripeWebhook.test.ts`:

```typescript
test("handleSubscriptionUpdated falls back to metadata.firebase_uid when customer has no email", async () => {
  let renewalArgs: unknown = null;
  let firebaseUidLookedUp: string | null = null;

  const sub = {
    id: "sub_abc",
    status: "active",
    current_period_end: 1720000000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_monthly_20" } }] },
    customer: "cus_123",
  } as unknown as Stripe.Subscription;

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({
        deleted: false,
        email: null,
        metadata: { firebase_uid: "firebase-uid-1" },
      }),
    },
  } as unknown as Stripe;

  await handleSubscriptionUpdated(sub, mockStripe, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async () => null,
    findUserByFirebaseUid: async (uid: string) => {
      firebaseUidLookedUp = uid;
      return {id: "user-1", email: "user@example.com"};
    },
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async (userId: string, amount: number, expiresAt: Date, referenceId: string) => {
      renewalArgs = {userId, amount, expiresAt, referenceId};
      return true;
    },
    addCredits: async () => {},
    adjustCredits: async () => {},
  } as never);

  assert.equal(firebaseUidLookedUp, "firebase-uid-1");
  assert.deepEqual(renewalArgs, {
    userId: "user-1",
    amount: 300,
    expiresAt: new Date(1720000000 * 1000),
    referenceId: "sub_sub_abc_1720000000",
  });
});

test("handleSubscriptionUpdated falls back to stored stripe_customer_id when email and metadata both fail", async () => {
  let renewalArgs: unknown = null;
  let customerIdLookedUp: string | null = null;

  const sub = {
    id: "sub_abc",
    status: "active",
    current_period_end: 1720000000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_monthly_20" } }] },
    customer: "cus_123",
  } as unknown as Stripe.Subscription;

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({deleted: false, email: null, metadata: {}}),
    },
  } as unknown as Stripe;

  await handleSubscriptionUpdated(sub, mockStripe, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async () => null,
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async (customerId: string) => {
      customerIdLookedUp = customerId;
      return {id: "user-1", email: "user@example.com"};
    },
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async (userId: string, amount: number, expiresAt: Date, referenceId: string) => {
      renewalArgs = {userId, amount, expiresAt, referenceId};
      return true;
    },
    addCredits: async () => {},
    adjustCredits: async () => {},
  } as never);

  assert.equal(customerIdLookedUp, "cus_123");
  assert.ok(renewalArgs !== null);
});

test("handleSubscriptionUpdated no-ops when all lookup strategies fail", async () => {
  let upsertCalled = false;

  const sub = {
    id: "sub_abc",
    status: "active",
    current_period_end: 1720000000,
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_monthly_20" } }] },
    customer: "cus_123",
  } as unknown as Stripe.Subscription;

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({deleted: false, email: null, metadata: {}}),
    },
  } as unknown as Stripe;

  await handleSubscriptionUpdated(sub, mockStripe, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async () => null,
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => { upsertCalled = true; },
    renewSubscriptionCredits: async () => true,
    addCredits: async () => {},
    adjustCredits: async () => {},
  } as never);

  assert.equal(upsertCalled, false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="handleSubscriptionUpdated falls back|no-ops when all lookup"`
Expected: FAIL — current handler bails immediately on `!customer.email` without trying the new fallbacks

- [ ] **Step 3: Implement the fallback chain in `handleSubscriptionUpdated`**

Replace this block in `functions/src/stripeWebhook.ts`:

```typescript
  // Fetch customer to get their email
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted || !customer.email) {
    logger.warn("customer.subscription.updated: no customer email", {customerId});
    return;
  }

  const user = await deps.findUserByEmail(customer.email);
  if (!user) return;
```

with:

```typescript
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) {
    logger.warn("customer.subscription.updated: customer deleted", {customerId});
    return;
  }

  let user = customer.email ? await deps.findUserByEmail(customer.email) : null;

  if (!user) {
    const firebaseUid = typeof customer.metadata?.firebase_uid === "string" ? customer.metadata.firebase_uid : undefined;
    if (firebaseUid) {
      user = await deps.findUserByFirebaseUid(firebaseUid);
    }
  }

  if (!user) {
    user = await deps.findUserByStripeCustomerId(customerId);
  }

  if (!user) {
    logger.warn("customer.subscription.updated: unable to resolve user via email, metadata, or stored customer id", {customerId});
    return;
  }
```

Note the rest of the function references `customer.email` in `logger.info` calls further down — those remain valid since `customer.email` may now legitimately be `null`; that's fine for a log field.

- [ ] **Step 4: Export `handleSubscriptionDeleted` and apply the same fallback chain**

`handleSubscriptionDeleted` is currently not exported (unlike `handleSubscriptionUpdated` and, after Task 7, `handleChargeRefunded`), so it can't be unit-tested directly yet — needed for the provider-nulling test in Step 4a below. In `functions/src/stripeWebhook.ts`, change:

```typescript
async function handleSubscriptionDeleted(
```

to:

```typescript
export async function handleSubscriptionDeleted(
```

Replace:

```typescript
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted || !customer.email) {
    logger.warn("customer.subscription.deleted: no customer email", {subId: sub.id});
    return;
  }

  const user = await deps.findUserByEmail(customer.email);
  if (!user) return;

  await deps.upsertSubscription({
    userId: user.id,
    planTier: "free",
    planStatus: "cancelled",
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
  });

  logger.info("customer.subscription.deleted: subscription cancelled", {
    email: customer.email,
  });
}
```

with:

```typescript
  const customer = await stripe.customers.retrieve(customerId);
  if (customer.deleted) {
    logger.warn("customer.subscription.deleted: customer deleted", {subId: sub.id});
    return;
  }

  let user = customer.email ? await deps.findUserByEmail(customer.email) : null;

  if (!user) {
    const firebaseUid = typeof customer.metadata?.firebase_uid === "string" ? customer.metadata.firebase_uid : undefined;
    if (firebaseUid) {
      user = await deps.findUserByFirebaseUid(firebaseUid);
    }
  }

  if (!user) {
    user = await deps.findUserByStripeCustomerId(customerId);
  }

  if (!user) {
    logger.warn("customer.subscription.deleted: unable to resolve user via email, metadata, or stored customer id", {subId: sub.id, customerId});
    return;
  }

  await deps.upsertSubscription({
    userId: user.id,
    planTier: "free",
    planStatus: "cancelled",
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    subscriptionProvider: null,
    cancelAtPeriodEnd: false,
  });

  logger.info("customer.subscription.deleted: subscription cancelled", {
    email: customer.email,
  });
}
```

(`subscriptionProvider: null` and `cancelAtPeriodEnd: false` here implement part of Fix #1/#6 — this is the natural place to add them since we're already touching this call site.)

- [ ] **Step 4a: Add a direct test for `handleSubscriptionDeleted`'s provider-nulling (closes a coverage gap the spec explicitly calls out)**

Add `handleSubscriptionDeleted` to the test file's import block:

```typescript
import {
  getCreditPackQuantityFromInvoice,
  getInvoiceLineItemPriceId,
  mapStripeSubscriptionStatus,
  stripeWebhookHandler,
  handleInvoicePaymentSucceeded,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
} from "./stripeWebhook.js";
```

Add this test to `functions/src/stripeWebhook.test.ts`:

```typescript
test("handleSubscriptionDeleted nulls subscriptionProvider and resets to free/cancelled", async () => {
  let upsertArgs: {planTier?: unknown; planStatus?: unknown; subscriptionProvider?: unknown; cancelAtPeriodEnd?: unknown} | null = null;

  const sub = {
    id: "sub_abc",
    customer: "cus_123",
  } as unknown as Stripe.Subscription;

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({ deleted: false, email: "user@example.com" }),
    },
  } as unknown as Stripe;

  await handleSubscriptionDeleted(sub, mockStripe, {
    findUserByEmail: async (email: string) => ({id: "user-1", email}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async (params) => { upsertArgs = params; },
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
  } as never);

  assert.deepEqual(upsertArgs, {
    userId: "user-1",
    planTier: "free",
    planStatus: "cancelled",
    stripeSubscriptionId: "sub_abc",
    stripeCustomerId: "cus_123",
    subscriptionProvider: null,
    cancelAtPeriodEnd: false,
  });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="handleSubscriptionUpdated|handleSubscriptionDeleted"`
Expected: PASS (all existing + 4 new tests, including the provider-nulling test from Step 4a)

- [ ] **Step 6: Commit**

```bash
git add functions/src/stripeWebhook.ts functions/src/stripeWebhook.test.ts
git commit -m "feat(billing): Stripe customer lookup fallback chain (metadata, stored customer id)"
```

---

### Task 6: Stripe webhook — provider/cancelAtPeriodEnd on the remaining call sites (Fix #1 + #6)

**Files:**
- Modify: `functions/src/stripeWebhook.ts` (`handleCheckoutCompleted`, `handleSubscriptionUpdated`)
- Modify: `functions/src/stripeWebhook.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `functions/src/stripeWebhook.test.ts`:

```typescript
test("handleSubscriptionUpdated maps Stripe cancel_at_period_end onto upsertSubscription", async () => {
  let upsertArgs: {subscriptionProvider?: unknown; cancelAtPeriodEnd?: unknown} | null = null;

  const sub = {
    id: "sub_abc",
    status: "active",
    current_period_end: 1720000000,
    cancel_at_period_end: true,
    items: { data: [{ price: { id: "price_monthly_20" } }] },
    customer: "cus_123",
  } as unknown as Stripe.Subscription;

  const mockStripe = {
    customers: {
      retrieve: async (_id: string) => ({ deleted: false, email: "user@example.com" }),
    },
  } as unknown as Stripe;

  await handleSubscriptionUpdated(sub, mockStripe, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async (params) => { upsertArgs = params; },
    renewSubscriptionCredits: async () => true,
    addCredits: async () => {},
    adjustCredits: async () => {},
  } as never);

  assert.equal(upsertArgs?.subscriptionProvider, "stripe");
  assert.equal(upsertArgs?.cancelAtPeriodEnd, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="maps Stripe cancel_at_period_end"`
Expected: FAIL — `upsertArgs?.subscriptionProvider` is `undefined`

- [ ] **Step 3: Update `handleSubscriptionUpdated`'s `upsertSubscription` call**

In `functions/src/stripeWebhook.ts`, change:

```typescript
  await deps.upsertSubscription({
    userId: user.id,
    planTier: tier,
    planStatus,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
  });
```

to:

```typescript
  await deps.upsertSubscription({
    userId: user.id,
    planTier: tier,
    planStatus,
    stripeSubscriptionId: sub.id,
    stripeCustomerId: customerId,
    subscriptionProvider: "stripe",
    cancelAtPeriodEnd: sub.cancel_at_period_end ?? false,
  });
```

- [ ] **Step 4: Update `handleCheckoutCompleted`'s `upsertSubscription` call**

Change:

```typescript
      await deps.upsertSubscription({
        userId: user.id,
        planTier: tier,
        planStatus: "active",
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: customerId,
      });
```

to:

```typescript
      await deps.upsertSubscription({
        userId: user.id,
        planTier: tier,
        planStatus: "active",
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId: customerId,
        subscriptionProvider: "stripe",
        cancelAtPeriodEnd: false,
      });
```

- [ ] **Step 5: Run the full stripeWebhook test file**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="stripeWebhook|handleCheckoutCompleted|handleSubscriptionUpdated|handleSubscriptionDeleted|handleInvoicePaymentSucceeded"`
Expected: PASS

If `sub.cancel_at_period_end` causes a TypeScript error (Stripe SDK v22 removed some subscription fields from its types, per the existing `StripeSubRuntime` workaround for `current_period_end`), fall back to casting: change the line to `(sub as unknown as {cancel_at_period_end?: boolean}).cancel_at_period_end ?? false,` and re-run `npm run typecheck` to confirm it's clean.

- [ ] **Step 6: Commit**

```bash
git add functions/src/stripeWebhook.ts functions/src/stripeWebhook.test.ts
git commit -m "feat(billing): tag Stripe-owned subscriptions with provider and cancel_at_period_end"
```

---

### Task 7: Stripe webhook — partial refund proration (Fix #3)

**Files:**
- Modify: `functions/src/stripeWebhook.ts` (`handleChargeRefunded`)
- Modify: `functions/src/stripeWebhook.test.ts`

- [ ] **Step 1: Write the failing tests**

First, find the existing `handleChargeRefunded`-adjacent tests to confirm none exist yet:

Run: `grep -n "handleChargeRefunded" functions/src/stripeWebhook.test.ts`
Expected: no matches (the function isn't currently exported/tested directly — it's only reached via `stripeWebhookHandler`'s switch, and `handleChargeRefunded` is not exported). Export it so it can be tested directly, matching the pattern used for `handleSubscriptionUpdated`/`handleInvoicePaymentSucceeded`.

In `functions/src/stripeWebhook.ts`, change:

```typescript
async function handleChargeRefunded(
```

to:

```typescript
export async function handleChargeRefunded(
```

Add `handleChargeRefunded` to the test file's import block (which by this point, after Task 5's Step 4a, already includes `handleSubscriptionDeleted`):

```typescript
import {
  getCreditPackQuantityFromInvoice,
  getInvoiceLineItemPriceId,
  mapStripeSubscriptionStatus,
  stripeWebhookHandler,
  handleInvoicePaymentSucceeded,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
  handleChargeRefunded,
} from "./stripeWebhook.js";
```

Add these tests:

```typescript
test("handleChargeRefunded deducts the full amount on a full refund", async () => {
  let adjustArgs: {delta: number; reason: string; referenceId?: string} | null = null;

  const charge = {
    id: "ch_123",
    amount: 1000,
    amount_refunded: 1000,
    billing_details: {email: "user@example.com"},
    invoice: "in_123",
  } as unknown as Stripe.Charge;

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: {subscription_details: {subscription: null}},
        lines: {data: [{
          quantity: 1,
          pricing: {price_details: {price: "price_credit_pack"}},
        }]},
      }),
    },
  } as unknown as Stripe;

  await handleChargeRefunded(mockStripe, charge, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async (userId, delta, reason, referenceId) => {
      adjustArgs = {delta, reason, referenceId};
    },
  } as never);

  assert.deepEqual(adjustArgs, {delta: -100, reason: "stripe_refund", referenceId: "ch_123"});
});

test("handleChargeRefunded prorates a partial refund", async () => {
  let adjustArgs: {delta: number} | null = null;

  const charge = {
    id: "ch_124",
    amount: 1000,
    amount_refunded: 200,
    billing_details: {email: "user@example.com"},
    invoice: "in_124",
  } as unknown as Stripe.Charge;

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: {subscription_details: {subscription: null}},
        lines: {data: [{
          quantity: 1,
          pricing: {price_details: {price: "price_credit_pack"}},
        }]},
      }),
    },
  } as unknown as Stripe;

  await handleChargeRefunded(mockStripe, charge, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async (_userId, delta) => { adjustArgs = {delta}; },
  } as never);

  // 100 credits * (200/1000) = 20
  assert.deepEqual(adjustArgs, {delta: -20});
});

test("handleChargeRefunded does not call adjustCredits when charge.amount is 0", async () => {
  let adjustCalled = false;

  const charge = {
    id: "ch_125",
    amount: 0,
    amount_refunded: 0,
    billing_details: {email: "user@example.com"},
    invoice: "in_125",
  } as unknown as Stripe.Charge;

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: {subscription_details: {subscription: null}},
        lines: {data: [{
          quantity: 1,
          pricing: {price_details: {price: "price_credit_pack"}},
        }]},
      }),
    },
  } as unknown as Stripe;

  await handleChargeRefunded(mockStripe, charge, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async () => {},
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => { adjustCalled = true; },
  } as never);

  assert.equal(adjustCalled, false);
});

test("handleChargeRefunded nulls subscriptionProvider on a subscription refund", async () => {
  let upsertArgs: {subscriptionProvider?: unknown} | null = null;

  const charge = {
    id: "ch_126",
    amount: 2000,
    amount_refunded: 2000,
    billing_details: {email: "user@example.com"},
    invoice: "in_126",
  } as unknown as Stripe.Charge;

  const mockStripe = {
    invoices: {
      retrieve: async () => ({
        parent: {subscription_details: {subscription: "sub_1"}},
        lines: {data: []},
      }),
    },
  } as unknown as Stripe;

  await handleChargeRefunded(mockStripe, charge, {
    monthly20: "price_monthly_20",
    monthly50: "price_monthly_50",
    creditPack: "price_credit_pack",
  }, {
    findUserByEmail: async (email: string) => ({id: "user-1", email}),
    findUserByFirebaseUid: async () => null,
    findUserByStripeCustomerId: async () => null,
    upsertSubscription: async (params) => { upsertArgs = params; },
    renewSubscriptionCredits: async () => false,
    addCredits: async () => {},
    adjustCredits: async () => {},
  } as never);

  assert.equal(upsertArgs?.subscriptionProvider, null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="handleChargeRefunded"`
Expected: FAIL — full deduction is currently `-(CREDIT_PACK_AMOUNT * creditPackQty)` unconditionally (100, not prorated to 20), and `subscriptionProvider` isn't set at all

- [ ] **Step 3: Implement proration and provider-nulling**

In `functions/src/stripeWebhook.ts`, change:

```typescript
  if (creditPackQty > 0) {
    await deps.adjustCredits(
      user.id,
      -(CREDIT_PACK_AMOUNT * creditPackQty),
      "stripe_refund",
      charge.id
    );
    logger.info("charge.refunded: credits deducted", {
      email: customerEmail,
      credits: CREDIT_PACK_AMOUNT * creditPackQty,
    });
  } else if (isSubscriptionRefund) {
    // For subscription refunds, cancel the subscription
    await deps.upsertSubscription({
      userId: user.id,
      planTier: "free",
      planStatus: "cancelled",
    });
    logger.info("charge.refunded: subscription cancelled", {email: customerEmail});
  } else {
```

to:

```typescript
  if (creditPackQty > 0) {
    const refundRatio = charge.amount > 0 ? charge.amount_refunded / charge.amount : 0;
    const creditsToDeduct = Math.floor(CREDIT_PACK_AMOUNT * creditPackQty * refundRatio);
    if (creditsToDeduct > 0) {
      await deps.adjustCredits(
        user.id,
        -creditsToDeduct,
        "stripe_refund",
        charge.id
      );
      logger.info("charge.refunded: credits deducted", {
        email: customerEmail,
        credits: creditsToDeduct,
        refundRatio,
      });
    }
  } else if (isSubscriptionRefund) {
    // For subscription refunds, cancel the subscription
    await deps.upsertSubscription({
      userId: user.id,
      planTier: "free",
      planStatus: "cancelled",
      subscriptionProvider: null,
      cancelAtPeriodEnd: false,
    });
    logger.info("charge.refunded: subscription cancelled", {email: customerEmail});
  } else {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="handleChargeRefunded"`
Expected: PASS (4 new tests)

- [ ] **Step 5: Commit**

```bash
git add functions/src/stripeWebhook.ts functions/src/stripeWebhook.test.ts
git commit -m "fix(billing): prorate Stripe partial refunds instead of clawing back the full grant"
```

---

### Task 8: Stripe webhook — web-side subscription collision block (Fix #1, web)

**Files:**
- Modify: `functions/src/purchasePackageStripe.ts`
- Modify: `functions/src/purchasePackageStripe.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `functions/src/purchasePackageStripe.test.ts`, after the existing imports (add `userRepository`/`subscriptionService` mock capability by injecting `deps` — the handler currently takes only `request`, so this task also changes its signature; write the test against the new signature):

```typescript
test("purchasePackageStripeHandler rejects subscription purchase when an active RevenueCat subscription already exists", async (t) => {
  await withAdminAuthStub(async () => ({email: "user@example.com"}), async () => {
    await assert.rejects(
      async () => purchasePackageStripeHandler(
        {auth: {uid: "firebase-uid-1"}, data: {priceId: "price_monthly_20"}} as never,
        {
          userRepository: {
            findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
          },
          subscriptionService: {
            getSubscription: async () => ({
              planStatus: "active",
              planTier: "monthly_20",
              subscriptionProvider: "revenuecat",
            }),
          },
        } as never
      ),
      (err: unknown) => err instanceof HttpsError && err.code === "already-exists"
    );
  });
});

test("purchasePackageStripeHandler allows a credit-pack purchase even with an active RevenueCat subscription", async (t) => {
  stubHandlerDeps(t, "one_time", "sess_payg", "https://checkout.stripe.com/payg");

  await withAdminAuthStub(async () => ({email: "user@example.com"}), async () => {
    const url = await purchasePackageStripeHandler(
      {auth: {uid: "firebase-uid-1"}, data: {priceId: "price_credit_pack"}} as never,
      {
        userRepository: {
          findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
        },
        subscriptionService: {
          getSubscription: async () => ({
            planStatus: "active",
            planTier: "monthly_20",
            subscriptionProvider: "revenuecat",
          }),
        },
      } as never
    );

    assert.equal(url, "https://checkout.stripe.com/payg");
  });
});

test("purchasePackageStripeHandler allows subscription purchase when Cloud SQL user has no subscription row yet", async (t) => {
  stubHandlerDeps(t, "recurring", "sess_new", "https://checkout.stripe.com/new");

  await withAdminAuthStub(async () => ({email: "user@example.com"}), async () => {
    const url = await purchasePackageStripeHandler(
      {auth: {uid: "firebase-uid-1"}, data: {priceId: "price_monthly_20"}} as never,
      {
        userRepository: {
          findUserByFirebaseUid: async () => null,
        },
        subscriptionService: {
          getSubscription: async () => { throw new Error("should not be called"); },
        },
      } as never
    );

    assert.equal(url, "https://checkout.stripe.com/new");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="purchasePackageStripeHandler rejects subscription purchase|allows a credit-pack purchase|allows subscription purchase when Cloud SQL"`
Expected: FAIL — handler currently only accepts `request` (one argument), the new tests pass a second `deps` argument that's silently ignored, and no rejection occurs

- [ ] **Step 3: Add `deps` param and the block check to the handler**

In `functions/src/purchasePackageStripe.ts`, add imports:

```typescript
import { userRepository } from "./services/userRepository.js";
import { subscriptionService } from "./services/subscriptionService.js";
```

Change the handler signature from:

```typescript
const handler = async (request: CallableRequest) => {
```

to:

```typescript
const handler = async (
    request: CallableRequest,
    deps: {userRepository: typeof userRepository; subscriptionService: typeof subscriptionService} = {userRepository, subscriptionService}
) => {
```

After the `SUBSCRIPTION_PRICE_IDS` set is built and the `priceId`/`attemptId` validation block runs (i.e. right after the `if (!ALLOWED_PRICE_IDS.has(priceId))` check, and before `const stripe = getStripeClient();`), insert:

```typescript
    if (SUBSCRIPTION_PRICE_IDS.has(priceId)) {
        const cloudUser = await deps.userRepository.findUserByFirebaseUid(request.auth.uid);
        if (cloudUser) {
            const existingSubscription = await deps.subscriptionService.getSubscription(cloudUser.id);
            if (
                existingSubscription &&
                existingSubscription.planStatus === "active" &&
                existingSubscription.planTier !== "free" &&
                existingSubscription.subscriptionProvider === "revenuecat"
            ) {
                throw new HttpsError(
                    "already-exists",
                    "You already have an active subscription on mobile. Manage it in the App Store or Play Store."
                );
            }
        }
    }
```

Finally, since `onCall`'s handler is invoked by the framework with only `request`, update the export at the bottom to keep passing just `request` there (it already does — `handler` is called as `(request) => handler(request)`-equivalent via direct reference; confirm the existing `purchasePackageStripe = onCall({...}, handler)` line is unchanged, since `handler`'s second parameter has a default and Firebase only ever supplies one argument).

- [ ] **Step 4: Neutralize the new block in every existing test that reaches it**

`functions/src/db/cloudSql.ts:53` throws unconditionally in test env: `'Direct database access not allowed in test environment.'` Any existing test that uses `priceId: "price_monthly_20"` and gets past the `ALLOWED_PRICE_IDS` check (i.e. doesn't reject earlier for auth/attemptId/unknown-priceId/missing-config reasons) will now call the real `userRepository.findUserByFirebaseUid` → `getDb()` → **throw**, before ever reaching the behavior each test was written to exercise. This is not a maybe — it is guaranteed to break these 8 tests, all of which currently call `purchasePackageStripeHandler({...} as never)` with a single argument:

- `"purchasePackageStripeHandler uses subscription mode for recurring Stripe prices"` (line 227)
- `"purchasePackageStripeHandler warns when Stripe price type mismatches local mode expectation"` (line 258)
- `"purchasePackageStripeHandler creates a customer when none exists"` (line 309)
- `"purchasePackageStripeHandler rejects users without an email address"` (line 356) — this one reaches the new block *before* its own email check, since the block runs earlier in the handler than the email fetch
- `"purchasePackageStripeHandler fails when Stripe checkout session has no URL"` (line 389)
- `"purchasePackageStripeHandler sends metadata and client_reference_id to checkout session"` (line 420)
- `"purchasePackageStripeHandler appends attemptId to checkout return URLs and metadata"` (line 453)
- `"purchasePackageStripeHandler keeps UUID-like attemptId accepted and propagated"` (line 503)

Every one of these calls ends with the pattern `} as never);` or `} as never),`. In each of the 8 locations above, change the call from one argument to two — for example, the call at line 227 currently reads:

```typescript
      const result = await purchasePackageStripeHandler({
        auth: {uid: "firebase-uid-1"},
        data: {priceId: "price_monthly_20"},
      } as never);
```

Change it to:

```typescript
      const result = await purchasePackageStripeHandler({
        auth: {uid: "firebase-uid-1"},
        data: {priceId: "price_monthly_20"},
      } as never, {userRepository: {findUserByFirebaseUid: async () => null}} as never);
```

(i.e. append `, {userRepository: {findUserByFirebaseUid: async () => null}} as never` immediately before the final closing `)` of the call, whether it ends in `} as never);` or `} as never),`). `findUserByFirebaseUid` returning `null` means `cloudUser` is falsy, so `subscriptionService.getSubscription` is never invoked — no need to also stub `subscriptionService` in these 8 sites. Apply this exact one-argument-to-two-argument edit at all 8 locations listed above; do not change any other test (the ones using `price_monthly_50` or `price_unknown`, or that reject before the price-id check, never reach the new block and are unaffected).

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="purchasePackageStripeHandler"`
Expected: PASS (all existing tests, now neutralized against the new block, + the 3 new tests from Step 1)

- [ ] **Step 6: Commit**

```bash
git add functions/src/purchasePackageStripe.ts functions/src/purchasePackageStripe.test.ts
git commit -m "feat(billing): block new Stripe subscription checkout when an active RevenueCat sub exists"
```

---

### Task 9: RevenueCat webhook — object-param `upsertSubscription`, provider, cancelAtPeriodEnd (Fix #1 + #6)

This is the largest task — it changes `RevenueCatDeps.upsertSubscription`'s signature from positional args to a single params object, which touches every call site and every existing test in the file. Do this task in one sitting; do not leave the signature half-migrated.

**Files:**
- Modify: `functions/src/revenueCatWebhook.ts`
- Modify: `functions/src/revenueCatWebhook.test.ts`

- [ ] **Step 1: Change the `RevenueCatDeps` interface and `defaultDeps`**

In `functions/src/revenueCatWebhook.ts`, replace:

```typescript
interface RevenueCatDeps {
  findUserByFirebaseUid: (firebaseUid: string) => Promise<{id: string} | null>;
  getOrCreateUserByFirebaseUid?: (firebaseUid: string) => Promise<{id: string} | null>;
  upsertSubscription: (
    userId: string,
    planTier: "free" | "monthly_20" | "monthly_50" | "payg",
    planStatus: "active" | "cancelled" | "expired",
    renewalAt?: Date | null,
    stripeSubscriptionId?: string | null
  ) => Promise<void>;
  renewSubscriptionCredits: (userId: string, amount: number, expiresAt: Date, referenceId: string) => Promise<boolean>;
  addCredits: (userId: string, amount: number, expiresAt: Date | null, transactionType: 'one_time' | 'signup' | 'legacy', referenceId?: string) => Promise<void>;
}
```

with:

```typescript
interface RevenueCatUpsertParams {
  userId: string;
  planTier: "free" | "monthly_20" | "monthly_50" | "payg";
  planStatus: "active" | "cancelled" | "expired";
  renewalAt?: Date | null;
  subscriptionProvider?: "stripe" | "revenuecat" | null;
  cancelAtPeriodEnd?: boolean;
}

interface ExistingSubscriptionLookup {
  planTier: string;
  planStatus: string;
  subscriptionProvider: string | null;
}

interface RevenueCatDeps {
  findUserByFirebaseUid: (firebaseUid: string) => Promise<{id: string} | null>;
  getOrCreateUserByFirebaseUid?: (firebaseUid: string) => Promise<{id: string} | null>;
  getSubscription: (userId: string) => Promise<ExistingSubscriptionLookup | null>;
  upsertSubscription: (params: RevenueCatUpsertParams) => Promise<void>;
  renewSubscriptionCredits: (userId: string, amount: number, expiresAt: Date, referenceId: string) => Promise<boolean>;
  addCredits: (userId: string, amount: number, expiresAt: Date | null, transactionType: 'one_time' | 'signup' | 'legacy', referenceId?: string) => Promise<void>;
}
```

Replace the `defaultDeps.upsertSubscription` implementation:

```typescript
  async upsertSubscription(userId, planTier, planStatus, renewalAt, stripeSubscriptionId) {
    await subscriptionService.upsertSubscription({
      userId,
      planTier,
      planStatus,
      billingCycleEnd: renewalAt,
      stripeSubscriptionId,
    });
  },
```

with:

```typescript
  async upsertSubscription(params: RevenueCatUpsertParams) {
    await subscriptionService.upsertSubscription({
      userId: params.userId,
      planTier: params.planTier,
      planStatus: params.planStatus,
      billingCycleEnd: params.renewalAt,
      subscriptionProvider: params.subscriptionProvider,
      cancelAtPeriodEnd: params.cancelAtPeriodEnd,
    });
  },
  async getSubscription(userId: string) {
    const sub = await subscriptionService.getSubscription(userId);
    if (!sub) return null;
    return {
      planTier: sub.planTier,
      planStatus: sub.planStatus,
      subscriptionProvider: sub.subscriptionProvider,
    };
  },
```

(Note `stripeSubscriptionId` is dropped from this call entirely — it was never actually populated with a meaningful value from RevenueCat call sites per the existing "does not map RevenueCat transaction ID to stripeSubscriptionId" test, so this is a no-op removal, not a behavior change. Confirm this in Step 6.)

- [ ] **Step 2: Update the `INITIAL_PURCHASE`/`RENEWAL` branch — provider, cancelAtPeriodEnd, and collision detection**

Replace:

```typescript
      case "INITIAL_PURCHASE":
      case "RENEWAL": {
        if (REVENUECAT_PRODUCT_TO_TIER[normalizedProductId]) {
          const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;

          await deps.upsertSubscription(
            cloudUser.id,
            tier,
            "active",
            renewalAt
          );

          if (renewalAt && original_transaction_id && typeof expiration_at_ms === 'number') {
            // Use a per-cycle key: original_transaction_id alone would block all future renewals
            // since it is stable for the lifetime of the subscription.
            const referenceId = `${original_transaction_id}_${expiration_at_ms}`;
            await deps.renewSubscriptionCredits(cloudUser.id, 300, renewalAt, referenceId);
          }

          logger.info("RevenueCat: subscription upserted + credits renewed", {
            app_user_id,
            tier,
            type,
          });
        } else if (isRevenueCatCreditPackProduct(product_id)) {
          const expiresAt = new Date(Date.now() + CREDIT_PACK_EXPIRY_MS);
          await deps.addCredits(
            cloudUser.id,
            CREDIT_PACK_AMOUNT,
            expiresAt,
            'one_time',
            original_transaction_id ?? undefined
          );
          logger.info("RevenueCat: credits added", {app_user_id, credits: CREDIT_PACK_AMOUNT});
        }
        break;
      }
```

with:

```typescript
      case "INITIAL_PURCHASE":
      case "RENEWAL": {
        if (REVENUECAT_PRODUCT_TO_TIER[normalizedProductId]) {
          const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;

          const existingSubscription = await deps.getSubscription(cloudUser.id);
          if (
            existingSubscription &&
            existingSubscription.subscriptionProvider === "stripe" &&
            existingSubscription.planStatus === "active" &&
            existingSubscription.planTier !== "free"
          ) {
            logger.warn("billing_provider_collision: RevenueCat purchase granted while an active Stripe subscription exists", {
              app_user_id,
              existingTier: existingSubscription.planTier,
              newTier: tier,
            });
          }

          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: tier,
            planStatus: "active",
            renewalAt,
            subscriptionProvider: "revenuecat",
            cancelAtPeriodEnd: false,
          });

          if (renewalAt && original_transaction_id && typeof expiration_at_ms === 'number') {
            // Use a per-cycle key: original_transaction_id alone would block all future renewals
            // since it is stable for the lifetime of the subscription.
            const referenceId = `${original_transaction_id}_${expiration_at_ms}`;
            await deps.renewSubscriptionCredits(cloudUser.id, 300, renewalAt, referenceId);
          }

          logger.info("RevenueCat: subscription upserted + credits renewed", {
            app_user_id,
            tier,
            type,
          });
        } else if (isRevenueCatCreditPackProduct(product_id)) {
          if (!original_transaction_id) {
            logger.warn("RevenueCat: credit-pack event missing original_transaction_id, rejecting so RevenueCat retries", {
              app_user_id,
              product_id,
              type,
            });
            res.status(503).json({received: false, error: "Missing original_transaction_id"});
            return;
          }
          const expiresAt = new Date(Date.now() + CREDIT_PACK_EXPIRY_MS);
          await deps.addCredits(
            cloudUser.id,
            CREDIT_PACK_AMOUNT,
            expiresAt,
            'one_time',
            original_transaction_id
          );
          logger.info("RevenueCat: credits added", {app_user_id, credits: CREDIT_PACK_AMOUNT});
        }
        break;
      }
```

- [ ] **Step 3: Update the `PRODUCT_CHANGE` branch**

Replace:

```typescript
      case "PRODUCT_CHANGE": {
        if (REVENUECAT_PRODUCT_TO_TIER[normalizedProductId]) {
          const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;

          await deps.upsertSubscription(
            cloudUser.id,
            tier,
            "active",
            renewalAt
          );

          // No credit renewal on plan change — credits are granted on RENEWAL events.
          // Granting here would double-credit users who change plans mid-cycle.
          logger.info("RevenueCat: subscription product change upserted", {
            app_user_id,
            tier,
            type,
          });
        }
        break;
      }
```

with:

```typescript
      case "PRODUCT_CHANGE": {
        if (REVENUECAT_PRODUCT_TO_TIER[normalizedProductId]) {
          const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;

          const existingSubscription = await deps.getSubscription(cloudUser.id);
          if (
            existingSubscription &&
            existingSubscription.subscriptionProvider === "stripe" &&
            existingSubscription.planStatus === "active" &&
            existingSubscription.planTier !== "free"
          ) {
            logger.warn("billing_provider_collision: RevenueCat product change granted while an active Stripe subscription exists", {
              app_user_id,
              existingTier: existingSubscription.planTier,
              newTier: tier,
            });
          }

          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: tier,
            planStatus: "active",
            renewalAt,
            subscriptionProvider: "revenuecat",
            cancelAtPeriodEnd: false,
          });

          // No credit renewal on plan change — credits are granted on RENEWAL events.
          // Granting here would double-credit users who change plans mid-cycle.
          logger.info("RevenueCat: subscription product change upserted", {
            app_user_id,
            tier,
            type,
          });
        }
        break;
      }
```

- [ ] **Step 4: Update the `NON_RENEWING_PURCHASE` branch (missing `original_transaction_id` guard)**

Replace:

```typescript
      case "NON_RENEWING_PURCHASE": {
        if (isRevenueCatCreditPackProduct(product_id)) {
          const expiresAt = new Date(Date.now() + CREDIT_PACK_EXPIRY_MS);
          await deps.addCredits(
            cloudUser.id,
            CREDIT_PACK_AMOUNT,
            expiresAt,
            'one_time',
            original_transaction_id ?? undefined
          );
          logger.info("RevenueCat: non-renewing credits added", {app_user_id});
        }
        break;
      }
```

with:

```typescript
      case "NON_RENEWING_PURCHASE": {
        if (isRevenueCatCreditPackProduct(product_id)) {
          if (!original_transaction_id) {
            logger.warn("RevenueCat: non-renewing credit-pack event missing original_transaction_id, rejecting so RevenueCat retries", {
              app_user_id,
              product_id,
              type,
            });
            res.status(503).json({received: false, error: "Missing original_transaction_id"});
            return;
          }
          const expiresAt = new Date(Date.now() + CREDIT_PACK_EXPIRY_MS);
          await deps.addCredits(
            cloudUser.id,
            CREDIT_PACK_AMOUNT,
            expiresAt,
            'one_time',
            original_transaction_id
          );
          logger.info("RevenueCat: non-renewing credits added", {app_user_id});
        }
        break;
      }
```

- [ ] **Step 5: Update `CANCELLATION` and `EXPIRATION`**

Replace:

```typescript
      case "CANCELLATION": {
        const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
        if (tier) {
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;
          await deps.upsertSubscription(
            cloudUser.id,
            tier,
            "active",
            renewalAt
          );
          logger.info("RevenueCat: subscription cancellation recorded (auto-renew off, entitlement still active)", {
            app_user_id,
            product_id,
            tier,
          });
        } else {
          await deps.upsertSubscription(cloudUser.id, "free", "cancelled");
          logger.warn("RevenueCat: cancellation for unknown product, defaulting to free/cancelled", {
            app_user_id,
            product_id,
          });
        }
        break;
      }
      case "EXPIRATION": {
        await deps.upsertSubscription(cloudUser.id, "free", "expired");
        logger.info("RevenueCat: subscription expired", {app_user_id, product_id});
        break;
      }
```

with:

```typescript
      case "CANCELLATION": {
        const tier = REVENUECAT_PRODUCT_TO_TIER[normalizedProductId];
        if (tier) {
          const expirationDate = typeof expiration_at_ms === "number" && Number.isFinite(expiration_at_ms) ?
            new Date(expiration_at_ms) : null;
          const renewalAt = expirationDate && Number.isFinite(expirationDate.getTime()) ? expirationDate : null;
          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: tier,
            planStatus: "active",
            renewalAt,
            subscriptionProvider: "revenuecat",
            cancelAtPeriodEnd: true,
          });
          logger.info("RevenueCat: subscription cancellation recorded (auto-renew off, entitlement still active)", {
            app_user_id,
            product_id,
            tier,
          });
        } else {
          await deps.upsertSubscription({
            userId: cloudUser.id,
            planTier: "free",
            planStatus: "cancelled",
            subscriptionProvider: null,
            cancelAtPeriodEnd: false,
          });
          logger.warn("RevenueCat: cancellation for unknown product, defaulting to free/cancelled", {
            app_user_id,
            product_id,
          });
        }
        break;
      }
      case "EXPIRATION": {
        await deps.upsertSubscription({
          userId: cloudUser.id,
          planTier: "free",
          planStatus: "expired",
          subscriptionProvider: null,
          cancelAtPeriodEnd: false,
        });
        logger.info("RevenueCat: subscription expired", {app_user_id, product_id});
        break;
      }
```

- [ ] **Step 6: Update every test in `functions/src/revenueCatWebhook.test.ts`**

For each of the 8 test blocks that supply a `deps` object with a positional `upsertSubscription`, convert to the object-param form and add `getSubscription`. Concretely:

**Test at line ~155 (`does not renew credits on PRODUCT_CHANGE events`):**

```typescript
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => {
        renewCalls += 1;
        return true;
      },
      addCredits: async () => undefined,
    }
```

**Test at line ~191 (`keeps paid tier active on cancellation until expiration`):** change the collector type and callback to object form:

```typescript
  const upsertCalls: Array<{
    userId: string;
    planTier: string;
    planStatus: string;
    renewalAt: Date | null | undefined;
    subscriptionProvider?: string | null;
    cancelAtPeriodEnd?: boolean;
  }> = [];

  await revenueCatWebhookHandler(
    { /* ...unchanged request... */ } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async (params) => {
        upsertCalls.push(params);
      },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalls.length, 1);
  assert.deepEqual(upsertCalls[0], {
    userId: "cloud-user-1",
    planTier: "monthly_20",
    planStatus: "active",
    renewalAt: new Date(Date.UTC(2026, 4, 20)),
    subscriptionProvider: "revenuecat",
    cancelAtPeriodEnd: true,
  });
```

**Test at line ~236 (`normalizes expiration to free tier`):** same collector-to-object-param change; update the expected deepEqual to:

```typescript
  assert.deepEqual(upsertCalls[0], {
    userId: "cloud-user-1",
    planTier: "free",
    planStatus: "expired",
    subscriptionProvider: null,
    cancelAtPeriodEnd: false,
  });
```

and add `getSubscription: async () => null,` to that test's deps object (harmless — `EXPIRATION` never calls it, but keeping every deps object complete avoids relying on which branches happen to skip it).

**Test at line ~278 (`does not map RevenueCat transaction ID to stripeSubscriptionId`):** this test's whole premise (checking that `stripeSubscriptionId` isn't set) is now moot since the object-param `upsertSubscription` never had a `stripeSubscriptionId` field to begin with. Replace it with an equivalent assertion that `subscriptionProvider` is `"revenuecat"` and no `stripeSubscriptionId`-like field leaks through:

```typescript
test("revenueCatWebhookHandler tags new subscriptions with the revenuecat provider", async () => {
  const res = createResponseRecorder();
  let upsertArgs: {subscriptionProvider?: unknown} | null = null;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {authorization: "Bearer rc-secret"},
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          expiration_at_ms: Date.UTC(2026, 4, 20),
          original_transaction_id: "rc_txn_123",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async (params) => { upsertArgs = params; },
      renewSubscriptionCredits: async () => false,
      addCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertArgs?.subscriptionProvider, "revenuecat");
});
```

**Test at line ~332 (`bootstraps Cloud SQL user when missing`):** add `getSubscription: async () => null,` to the deps object; change the collector/callback to object form; update expected deepEqual to add `subscriptionProvider: "revenuecat", cancelAtPeriodEnd: false,`.

**Test at line ~378 (`maps Android base-plan-suffixed subscription IDs`):** same treatment — add `getSubscription`, convert to object param, add the two new fields to the expected deepEqual.

**Test at line ~423 (`maps cancellation for Android base-plan-suffixed subscription IDs`):** convert to object param; expected deepEqual gains `subscriptionProvider: "revenuecat", cancelAtPeriodEnd: true,` (known-product CANCELLATION path).

**Test at line ~468 (`returns retryable status when Cloud SQL user is unavailable`):** `upsertSubscription: async () => undefined,` stays a no-arg stub — no change needed to its body, but since the interface type changed, this dep object literal already type-checks fine as-is (it never destructures params). No edit strictly required here, but add `getSubscription: async () => null,` for consistency with every other deps object in the file.

- [ ] **Step 7: Write new tests for the two behaviors this task adds**

Add:

```typescript
test("revenueCatWebhookHandler grants credits and warns on billing_provider_collision when an active Stripe subscription already exists", async () => {
  const res = createResponseRecorder();
  let upsertCalled = false;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {authorization: "Bearer rc-secret"},
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_123",
          product_id: "monthly_20_subscription",
          expiration_at_ms: Date.UTC(2026, 4, 20),
          original_transaction_id: "rc_txn_123",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => ({
        planTier: "monthly_20",
        planStatus: "active",
        subscriptionProvider: "stripe",
      }),
      upsertSubscription: async () => { upsertCalled = true; },
      renewSubscriptionCredits: async () => true,
      addCredits: async () => undefined,
    }
  );

  assert.equal(res.statusCode, 200);
  assert.equal(upsertCalled, true);
});

test("revenueCatWebhookHandler rejects a credit-pack event missing original_transaction_id so RevenueCat retries", async () => {
  const res = createResponseRecorder();
  let addCreditsCalled = false;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {authorization: "Bearer rc-secret"},
      body: {
        event: {
          type: "INITIAL_PURCHASE",
          app_user_id: "uid_123",
          product_id: "credit_pack_100",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => { addCreditsCalled = true; },
    }
  );

  assert.equal(res.statusCode, 503);
  assert.equal(addCreditsCalled, false);
});

test("revenueCatWebhookHandler rejects a NON_RENEWING_PURCHASE credit-pack event missing original_transaction_id", async () => {
  const res = createResponseRecorder();
  let addCreditsCalled = false;

  await revenueCatWebhookHandler(
    {
      method: "POST",
      headers: {authorization: "Bearer rc-secret"},
      body: {
        event: {
          type: "NON_RENEWING_PURCHASE",
          app_user_id: "uid_123",
          product_id: "credit_100",
        },
      },
    } as never,
    res as never,
    {
      findUserByFirebaseUid: async () => ({id: "cloud-user-1"}),
      getSubscription: async () => null,
      upsertSubscription: async () => {},
      renewSubscriptionCredits: async () => false,
      addCredits: async () => { addCreditsCalled = true; },
    }
  );

  assert.equal(res.statusCode, 503);
  assert.equal(addCreditsCalled, false);
});
```

- [ ] **Step 8: Run the full test file and typecheck**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="revenueCatWebhookHandler|parseRevenueCatEvent"`
Expected: PASS (all existing tests updated + 5 new ones)

Run: `cd functions && npm run typecheck`
Expected: no errors

- [ ] **Step 9: Commit**

```bash
git add functions/src/revenueCatWebhook.ts functions/src/revenueCatWebhook.test.ts
git commit -m "feat(billing): RevenueCat provider/cancelAtPeriodEnd tagging, collision logging, missing-txn-id guard"
```

---

### Task 10: Client — expose `cancelAtPeriodEnd` through bootstrap (Fix #6)

**Files:**
- Modify: `functions/src/exchangeToken.ts`
- Modify: `functions/src/exchangeToken.test.ts`
- Modify: `src/auth/bootstrapSession.ts`

- [ ] **Step 1: Write the failing test**

In `functions/src/exchangeToken.test.ts`, update the `mockSubscription` at line 91 (inside the `"exchangeTokenHandler bootstraps a new user with onboarding credits"` test) by adding one field:

```typescript
  const mockSubscription = {
    userId: "user-123",
    planTier: "free",
    planStatus: "active",
    currentCredits: 50,
    termsVersion: null,
    termsAcceptedAt: null,
    nextExpiryDate: null,
    cancelAtPeriodEnd: false,
  };
```

And update the expected `subscription` block in that same test's `assert.deepEqual(result, {...})` (around line 143-150):

```typescript
    subscription: {
      planTier: mockSubscription.planTier,
      planStatus: mockSubscription.planStatus,
      currentCredits: mockSubscription.currentCredits,
      termsVersion: mockSubscription.termsVersion,
      termsAcceptedAt: mockSubscription.termsAcceptedAt,
      nextExpiryDate: mockSubscription.nextExpiryDate,
      cancelAtPeriodEnd: mockSubscription.cancelAtPeriodEnd,
    },
```

Do the same for the `"exchangeTokenHandler returns existing user and subscription"` test's `mockSubscription` (around line 167) and its expected block (around line 217-223) — add `cancelAtPeriodEnd: true,` to the mock (pick `true` here specifically so this test is distinct from the other one, which uses `false`) and `cancelAtPeriodEnd: mockSubscription.cancelAtPeriodEnd,` to the expected block.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="exchangeTokenHandler bootstraps a new user|exchangeTokenHandler returns existing user"`
Expected: FAIL — `assert.deepEqual` mismatch, actual result is missing `cancelAtPeriodEnd`

- [ ] **Step 3: Add `cancelAtPeriodEnd` to the `exchangeToken` response payload**

In `functions/src/exchangeToken.ts`, change:

```typescript
            subscription: {
                planTier: subscription.planTier,
                planStatus: subscription.planStatus,
                currentCredits: syncedCredits,
                termsVersion: subscription.termsVersion,
                termsAcceptedAt: toISO(subscription.termsAcceptedAt),
                nextExpiryDate: toISO(subscription.nextExpiryDate),
            },
```

to:

```typescript
            subscription: {
                planTier: subscription.planTier,
                planStatus: subscription.planStatus,
                currentCredits: syncedCredits,
                termsVersion: subscription.termsVersion,
                termsAcceptedAt: toISO(subscription.termsAcceptedAt),
                nextExpiryDate: toISO(subscription.nextExpiryDate),
                cancelAtPeriodEnd: subscription.cancelAtPeriodEnd ?? false,
            },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd functions && npm run build && npm test -- --test-name-pattern="exchangeTokenHandler"`
Expected: PASS (all exchangeToken tests)

- [ ] **Step 5: Add the field to the client `SubscriptionSnapshot` type**

In `src/auth/bootstrapSession.ts`, change:

```typescript
export interface SubscriptionSnapshot {
  planTier: string
  planStatus: string
  currentCredits: number
  termsVersion: string | null
  termsAcceptedAt: string | null
  nextExpiryDate: string | null
}
```

to:

```typescript
export interface SubscriptionSnapshot {
  planTier: string
  planStatus: string
  currentCredits: number
  termsVersion: string | null
  termsAcceptedAt: string | null
  nextExpiryDate: string | null
  cancelAtPeriodEnd?: boolean
}
```

(Optional, not required — the dev-sandbox mock literal further down this same file doesn't set it, and marking it optional avoids having to touch that mock or any test that constructs a `SubscriptionSnapshot`-shaped literal without it.)

- [ ] **Step 6: Run the client test suite for anything touching bootstrap/subscription types**

Run: `npm test -- bootstrapSession useCurrentPlan useAuthSnapshot`
Expected: PASS (no changes expected — the field is optional and untouched by these tests)

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add functions/src/exchangeToken.ts functions/src/exchangeToken.test.ts src/auth/bootstrapSession.ts
git commit -m "feat(billing): expose cancelAtPeriodEnd through bootstrap/exchangeToken"
```

---

### Task 11: Client — surface the web subscription-block error message

**Files:**
- Modify: `src/components/CreditsDisplay.tsx`
- Modify: `__tests__/creditsDisplayPurchase.test.tsx` (existing file — uses `react-test-renderer`, mocks `makePackagePurchase` via `mockMakePackagePurchase`, and already has a precedent test at `'resets web purchase state and shows error snackbar on checkout failure'` asserting on `JSON.stringify(tree.toJSON())`)

- [ ] **Step 1: Write the failing tests**

Add these two tests to the `describe('CreditsDisplay purchase flows', ...)` block in `__tests__/creditsDisplayPurchase.test.tsx`, right after the existing `'resets web purchase state and shows error snackbar on checkout failure'` test:

```typescript
  it('shows the server-provided message when subscribe is blocked by an existing mobile subscription', async () => {
    const blockedError = Object.assign(
      new Error('You already have an active subscription on mobile. Manage it in the App Store or Play Store.'),
      { code: 'functions/already-exists' }
    )
    mockMakePackagePurchase.mockRejectedValueOnce(blockedError)
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const subscribeButton = tree.root.findByProps({ testID: '300 credits / month · $20' })

    await act(async () => {
      await subscribeButton.props.onPress()
    })

    expect(JSON.stringify(tree.toJSON())).toContain(
      'You already have an active subscription on mobile. Manage it in the App Store or Play Store.'
    )
  })

  it('shows the generic message for a non-business-rule error code', async () => {
    const genericError = Object.assign(new Error('boom'), { code: 'functions/internal' })
    mockMakePackagePurchase.mockRejectedValueOnce(genericError)
    const CreditsDisplay = require('~/components/CreditsDisplay').default
    let tree!: ReturnType<typeof create>

    await act(async () => {
      tree = create(<CreditsDisplay />)
    })

    const subscribeButton = tree.root.findByProps({ testID: '300 credits / month · $20' })

    await act(async () => {
      await subscribeButton.props.onPress()
    })

    expect(JSON.stringify(tree.toJSON())).toContain('Purchase failed. Please try again.')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- creditsDisplayPurchase`
Expected: FAIL — the first new test fails because the current handler always sets the generic message regardless of error code

- [ ] **Step 3: Update `handleSubscribe`'s catch block**

In `src/components/CreditsDisplay.tsx`, change:

```typescript
  const handleSubscribe = async () => {
    if (!tryStartPurchase('subscribe')) {
      return
    }

    try {
      const purchaseResult = await makePackagePurchase('monthly_20')
      if (Platform.OS !== 'web' && purchaseResult != null) {
        refreshBootstrap('purchase')
      }
    } catch (e: any) {
      console.error(e)
      setErrorMessage('Purchase failed. Please try again.')
      if (Platform.OS === 'web') {
        resetPurchaseState()
      }
    } finally {
      if (Platform.OS !== 'web') {
        resetPurchaseState()
      }
    }
```

to:

```typescript
  const handleSubscribe = async () => {
    if (!tryStartPurchase('subscribe')) {
      return
    }

    try {
      const purchaseResult = await makePackagePurchase('monthly_20')
      if (Platform.OS !== 'web' && purchaseResult != null) {
        refreshBootstrap('purchase')
      }
    } catch (e: any) {
      console.error(e)
      const firebaseCode = typeof e?.code === 'string' ? e.code : undefined
      setErrorMessage(
        firebaseCode === 'functions/already-exists' && typeof e?.message === 'string'
          ? e.message
          : 'Purchase failed. Please try again.'
      )
      if (Platform.OS === 'web') {
        resetPurchaseState()
      }
    } finally {
      if (Platform.OS !== 'web') {
        resetPurchaseState()
      }
    }
```

(This mirrors the `firebaseCode === 'functions/failed-precondition'` convention already used in `src/hooks/useAIChat.ts:370` and `src/components/ChatComposer.tsx:118` — `already-exists` is a distinct, non-sensitive business-rule code, safe to show verbatim in any build, unlike generic internal errors.)

- [ ] **Step 4: Run the test suite and typecheck**

Run: `npm test -- creditsDisplayPurchase`
Expected: PASS (all existing tests + 2 new ones)

Run: `npm run typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add src/components/CreditsDisplay.tsx
git commit -m "feat(billing): surface the cross-platform subscription block message on web"
```

---

### Task 12: Client — regression test for the existing mobile `isPremium` gate

`__tests__/subscribeRestoreRefresh.test.tsx` already renders this exact screen with `react-test-renderer` and hardcodes `useIsPremium: () => false`. Reuse its verified mocking setup, but make `useIsPremium` togglable per-test.

**Files:**
- Create: `__tests__/subscribeScreenPremiumGate.test.tsx`

- [ ] **Step 1: Write the test**

Create `__tests__/subscribeScreenPremiumGate.test.tsx`:

```typescript
import React from 'react'
import { act, create } from 'react-test-renderer'

let mockPlatformOS: 'web' | 'ios' | 'android' = 'ios'
let mockIsPremium = false

jest.mock('react-native', () => {
    const React = require('react')

    return {
        View: ({ children, ...props }: any) => React.createElement('View', props, children),
        Pressable: ({ children, ...props }: any) => React.createElement('Pressable', props, children),
        Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
        ScrollView: ({ children, ...props }: any) => React.createElement('ScrollView', props, children),
        Platform: {
            get OS() {
                return mockPlatformOS
            },
        },
        StyleSheet: {
            create: (styles: unknown) => styles,
        },
        Linking: {
            openURL: jest.fn(),
        },
    }
})

jest.mock('react-native-paper', () => {
    const React = require('react')
    const { Pressable, Text: RNText, View } = require('react-native')

    const Button = ({ children, onPress, ...props }: any) => {
        const testIdFromChildren = typeof children === 'string' ? children : undefined
        return (
            <Pressable testID={props.testID ?? testIdFromChildren} onPress={onPress} {...props}>
                <RNText>{children}</RNText>
            </Pressable>
        )
    }

    const Card = ({ children, ...props }: any) => <View {...props}>{children}</View>
    Card.Content = ({ children, ...props }: any) => <View {...props}>{children}</View>

    const Text = ({ children, ...props }: any) => <RNText {...props}>{children}</RNText>
    const Snackbar = ({ visible, children }: any) => (visible ? <RNText>{children}</RNText> : null)
    const IconButton = ({ ...props }: any) => <View {...props} />
    const List = {
        Item: ({ children, ...props }: any) => <View {...props}>{children}</View>,
        Icon: ({ ...props }: any) => <View {...props} />,
    }
    const Divider = ({ ...props }: any) => <View {...props} />

    return { Card, Text, IconButton, Button, Snackbar, List, Divider }
})

jest.mock('expo-router', () => ({
    useRouter: () => ({ push: jest.fn() }),
}))

jest.mock('expo-router/react-navigation', () => ({
    useNavigation: () => ({ setOptions: jest.fn() }),
}))

jest.mock('@xstate/react', () => ({
    useSelector: jest.fn(() => ({ uid: 'firebase-uid-gate-test' })),
}))

jest.mock('~/hooks/useMachines', () => ({
    useAuthMachine: () => ({ send: jest.fn() }),
}))

jest.mock('~/hooks/useBootstrapRefresh', () => ({
    useBootstrapRefresh: () => jest.fn(),
}))

jest.mock('~/hooks/useIsPremium', () => ({
    useIsPremium: () => mockIsPremium,
}))

jest.mock('~/hooks/useUser', () => ({
    useUserPrivateData: () => ({ userPrivate: { credits: 0 } }),
    userKeys: {
        private: (uid: string | undefined) => ['user', 'private', uid],
    },
}))

jest.mock('~/utilities/makePackagePurchase', () => ({
    makePackagePurchase: jest.fn(),
}))

jest.mock('~/config/revenueCatConfig', () => ({
    restorePurchases: jest.fn(),
}))

jest.mock('~/components/CreditsDisplay', () => () => null)

describe('Subscribe screen monthly_20 button gating (provider-agnostic)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockPlatformOS = 'ios'
    })

    it('hides the monthly_20 button when isPremium is true, regardless of which platform granted it', async () => {
        mockIsPremium = true
        const SubscribeScreen = require('../app/(drawer)/subscribe').default
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<SubscribeScreen />)
        })

        expect(tree.root.findAllByProps({ testID: '300 credits / month · $20' })).toHaveLength(0)
    })

    it('shows the monthly_20 button when isPremium is false', async () => {
        mockIsPremium = false
        const SubscribeScreen = require('../app/(drawer)/subscribe').default
        let tree!: ReturnType<typeof create>

        await act(async () => {
            tree = create(<SubscribeScreen />)
        })

        expect(tree.root.findByProps({ testID: '300 credits / month · $20' })).toBeTruthy()
    })
})
```

`useIsPremium` is read as `() => mockIsPremium` (a closure over the outer `let`), so each test can flip it without `jest.resetModules()` — same pattern `subscribeRestoreRefresh.test.tsx` uses for `mockPlatformOS`.

- [ ] **Step 2: Run the test**

Run: `npm test -- subscribeScreenPremiumGate`
Expected: PASS (2 tests)

- [ ] **Step 3: Commit**

```bash
git add __tests__/subscribeScreenPremiumGate.test.tsx
git commit -m "test(billing): lock in isPremium gate hiding monthly_20 button regardless of provider"
```

---

### Task 13: Update `docs/billing-and-credits.md`

**Files:**
- Modify: `docs/billing-and-credits.md`

- [ ] **Step 1: Document the two new columns**

In the "Credit Model Reference" section area (or a new subsection right after "Refunds"), add:

```markdown
### Subscription Ownership & Auto-Renew

- `subscriptions.subscription_provider` (`'stripe' | 'revenuecat' | NULL`) tracks which platform currently owns an active paid subscription. `purchasePackageStripe` rejects a new web subscription checkout if the caller already has an active RevenueCat-owned subscription (`already-exists` error). RevenueCat purchases cannot be blocked before the store charges the user, so a bypass/race is resolved by granting the entitlement anyway and logging a `billing_provider_collision` warning for manual reconciliation.
- `subscriptions.cancel_at_period_end` (boolean) is `true` when an active subscription will not renew — set directly from Stripe's `cancel_at_period_end` field on `customer.subscription.updated`, and set on RevenueCat `CANCELLATION` for a known product. Exposed to the client via bootstrap/`exchangeToken` as `subscription.cancelAtPeriodEnd`.
```

- [ ] **Step 2: Update the Stripe event → action table**

Add a row noting event-level idempotency:

```markdown
All Stripe events are deduped via a `processed_stripe_events(event_id)` table checked before dispatch — a replayed event returns 200 immediately without re-running its handler. If handler dispatch throws, the dedupe row is deleted before the 500 response so Stripe's retry isn't silently swallowed.
```

Place this directly under the existing "Idempotency guard must run before expiring old credits..." note.

- [ ] **Step 3: Update the `charge.refunded` row**

Change:

```markdown
| `charge.refunded` | Deduct credits |
```

to:

```markdown
| `charge.refunded` | Deduct credits, prorated by `amount_refunded / amount` for partial refunds |
```

- [ ] **Step 4: Update the RevenueCat event table's `CANCELLATION` row context**

The existing row already says "Known subscription → keep `plan_status = 'active'` with auto-renew off." — add one sentence directly below the table:

```markdown
"Auto-renew off" above is now a real column (`cancel_at_period_end = true`), not just a description — see Subscription Ownership & Auto-Renew.
```

- [ ] **Step 5: Commit**

```bash
git add docs/billing-and-credits.md
git commit -m "docs(billing): document subscription_provider, cancel_at_period_end, Stripe event dedupe"
```

---

### Task 14: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full functions suite**

Run: `cd functions && npm run typecheck && npm run lint && npm run build && npm test`
Expected: all pass, 0 failures

- [ ] **Step 2: Run the full root suite**

Run: `npm run typecheck && npm run lint && npm test`
Expected: all pass, 0 failures

- [ ] **Step 3: Manually re-read the spec one more time and check off every fix**

Go through `docs/superpowers/specs/2026-07-01-billing-hardening-design.md` fix-by-fix (#1 through #6) and confirm each has a corresponding merged change. If anything was missed, add a follow-up task before considering this plan complete.

- [ ] **Step 4: Update the spec's status**

Change the spec's header from `**Status:** Approved` to `**Status:** Implemented`, and add a `**PR:** #<number>` line once a PR exists (leave this line out if not opening a PR immediately).

```bash
git add docs/superpowers/specs/2026-07-01-billing-hardening-design.md
git commit -m "docs(billing): mark hardening spec implemented"
```
