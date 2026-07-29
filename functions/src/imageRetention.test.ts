import assert from "node:assert/strict";
import test from "node:test";

process.env.NODE_ENV = "test";
process.env.GCLOUD_PROJECT = "test-project";

const {imageRetentionSweepHandler, RETENTION_DAYS} = await import("./imageRetention.js");

test("RETENTION_DAYS matches the spec's 30-day tombstone window", () => {
  assert.equal(RETENTION_DAYS, 30);
});

test("imageRetentionSweepHandler delegates to characterImageService.sweepExpiredTombstones", async () => {
  let receivedDays: number | undefined;
  const deps = {
    characterImageService: {
      sweepExpiredTombstones: async (days: number) => {
        receivedDays = days;
        return 3;
      },
    },
  };
  await imageRetentionSweepHandler(deps as never);
  assert.equal(receivedDays, RETENTION_DAYS);
});
