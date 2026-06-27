import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSourceTypeForExport,
  normalizeSourceTypeForStorage,
  VALID_SYNC_SOURCE_TYPES,
} from "./wikiSourceType.js";

test("VALID_SYNC_SOURCE_TYPES includes legacy and v4 values", () => {
  for (const value of [
    "user_stated",
    "agent_inferred",
    "user_confirmed",
    "user_document",
    "librarian_inferred",
    "immutable_document",
  ]) {
    assert.equal(VALID_SYNC_SOURCE_TYPES.has(value), true, value);
  }
});

test("normalizeSourceTypeForStorage maps v4 values to legacy storage", () => {
  assert.equal(normalizeSourceTypeForStorage("librarian_inferred"), "agent_inferred");
  assert.equal(normalizeSourceTypeForStorage("immutable_document"), "user_document");
  assert.equal(normalizeSourceTypeForStorage("user_stated"), "user_stated");
  assert.equal(normalizeSourceTypeForStorage(null), "agent_inferred");
});

test("normalizeSourceTypeForExport maps legacy values to v4 client values", () => {
  assert.equal(normalizeSourceTypeForExport("agent_inferred"), "librarian_inferred");
  assert.equal(normalizeSourceTypeForExport("user_document"), "immutable_document");
  assert.equal(normalizeSourceTypeForExport("user_confirmed"), "user_confirmed");
  assert.equal(normalizeSourceTypeForExport(null), null);
});
