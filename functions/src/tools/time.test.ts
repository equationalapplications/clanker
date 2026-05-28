import assert from "node:assert/strict";
import test from "node:test";

import { getCurrentTimeTool } from "./time.js";

test("getCurrentTimeTool has name 'get_current_time'", () => {
  assert.equal(getCurrentTimeTool.name, "get_current_time");
});

test("getCurrentTimeTool.execute returns a non-empty string", async () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await (getCurrentTimeTool as any).execute({});
  assert.ok(typeof result === "string" && result.length > 0, `expected non-empty string, got: ${String(result)}`);
});
