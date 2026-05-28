import assert from "node:assert/strict";
import test from "node:test";

import { getCurrentTimeManifest } from "@equationalapplications/core-llm-tools";

import { getCurrentTimeTool } from "./time.js";

test("getCurrentTimeTool inherits name from manifest", () => {
  assert.equal(getCurrentTimeTool.name, getCurrentTimeManifest.schema.name);
});

test("getCurrentTimeTool.execute returns a non-empty string", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (getCurrentTimeTool as any).execute({});
  assert.ok(typeof result === "string" && result.length > 0, `expected non-empty string, got: ${String(result)}`);
});
