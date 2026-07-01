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
  assert.match(sql, /UPDATE "subscriptions" SET "subscription_provider" = 'stripe' WHERE "stripe_subscription_id" IS NOT NULL;/);
  assert.match(sql, /UPDATE "subscriptions" SET "subscription_provider" = 'revenuecat' WHERE "plan_tier" != 'free' AND "stripe_subscription_id" IS NULL;/);
});
