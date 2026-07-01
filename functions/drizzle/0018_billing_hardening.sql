ALTER TABLE "subscriptions" ADD COLUMN "subscription_provider" text;
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscription_provider_check" CHECK ("subscription_provider" IN ('stripe', 'revenuecat'));

CREATE TABLE "processed_stripe_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

UPDATE "subscriptions" SET "subscription_provider" = 'stripe' WHERE "stripe_subscription_id" IS NOT NULL;
UPDATE "subscriptions" SET "subscription_provider" = 'revenuecat' WHERE "plan_tier" != 'free' AND "stripe_subscription_id" IS NULL;
