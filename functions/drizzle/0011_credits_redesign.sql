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

-- Phase 4.1: Add DB defaults to match the Drizzle schema and prevent runtime inserts from failing when a field is omitted.
ALTER TABLE "credit_transactions" ALTER COLUMN "initial_amount" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ALTER COLUMN "remaining_balance" SET DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ALTER COLUMN "transaction_type" SET DEFAULT 'legacy';
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