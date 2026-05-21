# Credits Redesign Phase 1: DB Schema Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `initial_amount`, `remaining_balance`, `transaction_type`, `expires_at` to `credit_transactions` and `next_expiry_date` to `subscriptions`, with full backfill of existing rows.

**Architecture:** Additive schema changes only — no existing column is modified or dropped. New columns added nullable, rows backfilled, then NOT NULL constraints applied. Drizzle schema file drives type generation; raw SQL migration is hand-edited to include backfill steps that `drizzle-kit` cannot generate automatically.

**Tech Stack:** PostgreSQL (Cloud SQL), Drizzle ORM v0.45, drizzle-kit v0.31

---

## File Structure

- Modify: `functions/src/db/schema.ts` — add new columns to `creditTransactions` and `subscriptions` table definitions
- Create: `functions/drizzle/0011_credits_redesign.sql` — migration SQL with additive columns + backfill
- Modify: `functions/drizzle/meta/_journal.json` — add entry for migration 0011 (drizzle-kit updates this automatically, but verify)
- No test file changes needed — this phase adds columns only; existing tests mock the DB and do not run migrations

---

## Task 1: Update Drizzle Schema

**Files:**
- Modify: `functions/src/db/schema.ts`

- [ ] **Step 1: Add `TransactionType` constant and columns to `creditTransactions`**

Open `functions/src/db/schema.ts`. Find the `creditTransactions` table definition (line 42). Add the four new columns and a CHECK constraint:

```typescript
// Add this type alias near the top of the file, after the imports:
export const TRANSACTION_TYPES = ['signup', 'subscription', 'one_time', 'legacy'] as const;
export type TransactionType = typeof TRANSACTION_TYPES[number];

// Updated creditTransactions table (replace existing definition):
export const creditTransactions = pgTable('credit_transactions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  reason: text('reason').notNull(),
  referenceId: text('reference_id'),
  initialAmount: integer('initial_amount').notNull(),
  remainingBalance: integer('remaining_balance').notNull(),
  transactionType: text('transaction_type').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  userIdIdx: index('credit_transactions_user_id_idx').on(table.userId),
  idempotencyIdx: uniqueIndex('credit_transactions_idempotency_idx')
    .on(table.userId, table.reason, table.referenceId)
    .where(sql`${table.referenceId} IS NOT NULL`),
  transactionTypeCheck: check(
    'credit_transactions_transaction_type_check',
    sql`${table.transactionType} IN ('signup', 'subscription', 'one_time', 'legacy')`
  ),
}));
```

- [ ] **Step 2: Add `nextExpiryDate` to `subscriptions`**

In `functions/src/db/schema.ts`, find the `subscriptions` table definition. Add `nextExpiryDate` after `billingCycleEnd`:

```typescript
export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').unique().notNull().references(() => users.id, { onDelete: 'cascade' }),
  planTier: text('plan_tier').notNull().default('free'),
  planStatus: text('plan_status').notNull().default('active'),
  currentCredits: integer('current_credits').notNull().default(0),
  termsVersion: text('terms_version'),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
  stripeSubscriptionId: text('stripe_subscription_id'),
  stripeCustomerId: text('stripe_customer_id'),
  billingCycleStart: timestamp('billing_cycle_start', { withTimezone: true }),
  billingCycleEnd: timestamp('billing_cycle_end', { withTimezone: true }),
  nextExpiryDate: timestamp('next_expiry_date', { withTimezone: true }),
  documentsIngestedCount: integer('documents_ingested_count').notNull().default(0),
  documentsIngestedDate: text('documents_ingested_date'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  planTierCheck: check('plan_tier_check', sql`${table.planTier} IN ('free', 'monthly_20', 'monthly_50', 'payg')`),
  planStatusCheck: check('plan_status_check', sql`${table.planStatus} IN ('active', 'cancelled', 'expired')`),
}));
```

- [ ] **Step 3: Run TypeScript check**

```bash
cd functions && npm run typecheck
```

Expected: no errors. If errors appear in files that reference `creditTransactions` columns, they are from Phase 2/3 — only fix errors in `schema.ts` itself here.

- [ ] **Step 4: Commit schema changes**

```bash
git add functions/src/db/schema.ts
git commit -m "feat(db): add balance/expiry columns to credit_transactions schema

Add initial_amount, remaining_balance, transaction_type, expires_at to
credit_transactions and next_expiry_date to subscriptions in Drizzle schema.
Migration SQL in next commit."
```

---

## Task 2: Generate and Edit Migration SQL

**Files:**
- Create: `functions/drizzle/0011_credits_redesign.sql`
- Modify: `functions/drizzle/meta/_journal.json` (updated by drizzle-kit automatically)

- [ ] **Step 1: Generate migration skeleton with drizzle-kit**

```bash
cd functions && npx drizzle-kit generate --name credits_redesign
```

Expected output: `[✓] Your SQL migration file ➜ drizzle/0011_credits_redesign.sql`

The generated file will contain `ALTER TABLE` statements adding the columns. It will add them as `NOT NULL` without defaults, which will fail on a non-empty table. We must edit it.

- [ ] **Step 2: Replace generated migration with the correct multi-step migration**

Open `functions/drizzle/0011_credits_redesign.sql`. Replace its entire contents with:

```sql
-- Phase 1: Add new columns as nullable (safe on non-empty table)
ALTER TABLE "credit_transactions" ADD COLUMN "initial_amount" integer;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "remaining_balance" integer;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "transaction_type" text;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD COLUMN "expires_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "next_expiry_date" timestamp with time zone;
--> statement-breakpoint

-- Phase 2: Backfill existing credit_transactions rows
-- initial_amount = ABS(delta) for all rows (delta can be negative for old spend audit rows)
-- remaining_balance = delta (positive add rows retain their full balance; negative spend rows
--   contribute their negative value so SUM(remaining_balance) equals the user's actual balance)
-- transaction_type = 'legacy' for all pre-migration rows
-- expires_at = NULL (legacy credits never expire)
UPDATE "credit_transactions"
SET
  initial_amount = ABS(delta),
  remaining_balance = delta,
  transaction_type = 'legacy',
  expires_at = NULL
WHERE initial_amount IS NULL;
--> statement-breakpoint

-- Phase 3: For users who have currentCredits > 0 but zero credit_transactions rows
-- (credits were seeded directly onto subscriptions.current_credits without a transaction row).
-- Insert one legacy row per such user so the SUM(remaining_balance) is correct.
INSERT INTO "credit_transactions" (
  user_id, delta, reason, initial_amount, remaining_balance, transaction_type, expires_at, created_at
)
SELECT
  s.user_id,
  s.current_credits,
  'legacy_bootstrap',
  s.current_credits,
  s.current_credits,
  'legacy',
  NULL,
  NOW()
FROM subscriptions s
WHERE s.current_credits > 0
  AND NOT EXISTS (
    SELECT 1 FROM credit_transactions ct WHERE ct.user_id = s.user_id
  );
--> statement-breakpoint

-- Phase 4: Apply NOT NULL constraints now that all rows are populated
ALTER TABLE "credit_transactions" ALTER COLUMN "initial_amount" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ALTER COLUMN "remaining_balance" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ALTER COLUMN "transaction_type" SET NOT NULL;
--> statement-breakpoint

-- Phase 5: Add CHECK constraint on transaction_type
ALTER TABLE "credit_transactions"
  ADD CONSTRAINT "credit_transactions_transaction_type_check"
  CHECK (transaction_type IN ('signup', 'subscription', 'one_time', 'legacy'));
--> statement-breakpoint

-- Phase 6: Add index on expires_at for fast expiry queries
CREATE INDEX "credit_transactions_expires_at_idx"
  ON "credit_transactions" (user_id, expires_at)
  WHERE expires_at IS NOT NULL;
```

- [ ] **Step 3: Verify the journal was updated by drizzle-kit**

Open `functions/drizzle/meta/_journal.json`. Confirm the last entry matches:

```json
{
  "idx": 11,
  "version": "7",
  "when": <timestamp>,
  "tag": "0011_credits_redesign",
  "breakpoints": true
}
```

If drizzle-kit did not add this entry, append it manually with `"idx": 11` and the current Unix timestamp in milliseconds.

- [ ] **Step 4: Review the generated snapshot**

Check `functions/drizzle/meta/0011_snapshot.json` exists (created by drizzle-kit). This snapshot should reflect the new schema columns. If the file is missing, run `npx drizzle-kit generate --name credits_redesign` again — it should regenerate the snapshot alongside the SQL.

- [ ] **Step 5: Commit migration**

```bash
git add functions/drizzle/
git commit -m "feat(db): migration 0011 — add balance/expiry columns with backfill

Adds initial_amount, remaining_balance, transaction_type, expires_at to
credit_transactions. Backfills all existing rows as transaction_type='legacy'.
Inserts one synthetic legacy row for users with credits but no transaction
rows. Adds next_expiry_date to subscriptions."
```

---

## Task 3: Update DB Trigger for New Users

**Context:** The Postgres function `handle_new_user()` (a DB-level trigger) currently inserts a `subscriptions` row with `current_credits = 50` when a new user is created. It does NOT insert a `credit_transactions` row. After this migration, new rows still work fine (the trigger fires, inserts subscription with 50 credits; Phase 2 will later add `addCredits` call in `subscriptionService`). However, the trigger's subscription insert will fail TypeScript typecheck in Drizzle if `initial_amount` is NOT NULL — but the trigger is raw SQL, not Drizzle, so no impact on TypeScript compilation.

**Action:** No code change needed in this phase. The trigger operates at the DB level and does not go through Drizzle. The trigger will be addressed in Phase 2 (via `subscriptionService.getOrCreateDefaultSubscription`). Document this decision:

- [ ] **Step 1: Add a comment to schema.ts near the subscriptions table**

Add this comment immediately above the `subscriptions` table export:

```typescript
// NOTE: The DB trigger handle_new_user() inserts into this table directly.
// Phase 2 of credits-redesign updates subscriptionService.getOrCreateDefaultSubscription
// to also insert a credit_transactions row for the 50-credit signup grant.
// The trigger remains as-is (it seeds currentCredits=50 as a cache; the actual
// credit row is created on first exchangeToken call via getOrCreateDefaultSubscription).
```

- [ ] **Step 2: Commit**

```bash
git add functions/src/db/schema.ts
git commit -m "docs(db): note DB trigger gap for Phase 2 follow-up"
```

---

## Task 4: Final Verification

- [ ] **Step 1: Build the functions project**

```bash
cd functions && npm run build
```

Expected: `Build completed successfully` with no TypeScript errors in `schema.ts` or any schema-importing file.

Note: TypeScript errors in `creditService.ts`, `stripeWebhook.ts`, etc. from the new columns being unknown to callers are expected at this stage and will be resolved in Phase 2.

- [ ] **Step 2: Run existing tests**

```bash
cd functions && npm test
```

Expected: All existing tests pass. The schema changes are additive and do not affect any test logic (tests mock the DB layer and never reference the new columns).

- [ ] **Step 3: Final commit if any fixups were needed**

```bash
git add -A
git commit -m "fix(db): phase 1 schema fixups after build/test verification"
```

---

## Self-Review Checklist

- [x] `initial_amount`, `remaining_balance`, `transaction_type`, `expires_at` added to `creditTransactions` in schema
- [x] `next_expiry_date` added to `subscriptions` in schema
- [x] Migration SQL adds columns nullable, backfills, then adds NOT NULL
- [x] Users with credits but no transaction rows get a synthetic legacy row
- [x] `TRANSACTION_TYPES` constant exported from schema for use in Phase 2
- [x] `TransactionType` TypeScript type exported from schema for use in Phase 2
- [x] No existing tests broken
- [x] TypeScript compiles (new columns are optional in insert operations — Drizzle infers this correctly because `initialAmount`/`remainingBalance`/`transactionType` are NOT NULL but creditService inserts are updated in Phase 2)

**Known gap:** After this phase, `creditService.spendCredits` and `addCredits` do not yet populate the new columns. Existing code still works because `currentCredits` on `subscriptions` is still the authoritative balance. Phase 2 migrates the logic.
