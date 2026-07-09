# Backend Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the two production failure families surfaced 2026-07-09 — client wiki SQLite transaction races and cloud-function 500s on empty Vertex responses — by adopting the patched `expo-llm-wiki`, routing ontology bootstrap through the wiki actor, and giving every Vertex text call a shared empty-response retry+logging helper.

**Architecture:** Two independently-shippable PRs targeting `staging`. **PR 1 (client):** bump `@equationalapplications/expo-llm-wiki`/`core-llm-wiki` to the serialization release + add a `bootstrapping` initial state to `wikiMachine` so ontology bootstrap is ordered before any read/write/sync. **PR 2 (functions):** extract a shared `vertexText.ts` retry helper (lifted from `generateReply.ts`), adopt it in `summarizeText`/`wikiLlm`/`memoryFunctions`/`convertDocumentText`/`generateReply`, drop `wikiLlm`'s degenerate `responseSchema`, and set a per-function `thinkingBudget` policy.

**Tech Stack:** TypeScript, XState v5 (client machine), Jest w/ `~` path alias (client tests), Firebase Functions v2 + `@google/genai` Vertex SDK, `node:test` (functions tests).

**Reference spec:** `docs/superpowers/specs/2026-07-09-backend-reliability-design.md` (Status: Approved).

**Sequencing rule:** PR 1 must be verified on the web prod-mirror (character save + cloud sync + Talk-tab entry produce **no** transaction errors or sync timeouts) **before** PR 2 merges. The two PRs are otherwise independent.

**Test commands:**
- Client (repo root): `npm test -- <testPathPattern>`
- Functions (`functions/` dir): `npm test` — this runs `npm run build` then `node --test lib/**/*.test.js`. There is no fast single-file runner; run the whole functions suite.

---

## File Structure

**PR 1 — client**
- Modify: `package.json:42-43` — dependency version bumps.
- Modify: `src/machines/wikiMachine.ts` — add `bootstrapping` initial state + `bootstrapOntologyActor`.
- Modify: `src/services/wikiOrchestrator.ts:54-60` — delete the fire-and-forget bootstrap block.
- Test: `__tests__/wikiMachine.test.ts` — bootstrap ordering + failure-still-drains tests.
- Test: `__tests__/wikiOrchestrator.test.ts` — existing suites pass with block removed.

**PR 2 — functions**
- Create: `functions/src/services/vertexText.ts` — shared client + `generateTextWithRetry`.
- Create: `functions/src/services/vertexText.test.ts` — unit tests for the helper.
- Modify: `functions/src/summarizeText.ts` — adopt helper (budget 0).
- Modify: `functions/src/wikiLlm.ts` — adopt helper + drop `responseSchema` + budget 1024.
- Modify: `functions/src/memoryFunctions.ts` — adopt helper in `defaultGenerateContent` (fixes latent `return ''` bug) + budget 1024.
- Modify: `functions/src/convertDocumentText.ts` — adopt helper (budget 0, multimodal parts).
- Modify: `functions/src/generateReply.ts:318-414` — migrate to shared client + retry predicate, keep its own loop for `functionCalls`/`groundingMetadata`.

---

# PR 1 — Client: dependency bump + ontology bootstrap through the actor

## Task 1: Bump `expo-llm-wiki` / `core-llm-wiki` to the serialization release

**Files:**
- Modify: `package.json:42-43`

- [ ] **Step 1: Update the two dependency versions**

In `package.json`, change lines 42-43 from:

```json
    "@equationalapplications/core-llm-wiki": "^4.19.0",
    "@equationalapplications/expo-llm-wiki": "^4.19.0",
```

to:

```json
    "@equationalapplications/core-llm-wiki": "^4.20.0",
    "@equationalapplications/expo-llm-wiki": "^4.20.0",
```

> `4.20.0` is the currently-published release carrying the internal transaction-serialization patch (confirmed via `npm view @equationalapplications/expo-llm-wiki version`). If a newer patch has published by execution time, re-run that command and use the version that includes the serialization work per the package spec `expo-llm-wiki/docs/superpowers/specs/2026-07-09-transaction-serialization-spec.md`.

- [ ] **Step 2: Install and lock**

Run: `npm install`
Expected: `package-lock.json` updates; both packages resolve to `4.20.x`. No peer-dependency errors.

- [ ] **Step 3: Verify the resolved version**

Run: `npm ls @equationalapplications/expo-llm-wiki @equationalapplications/core-llm-wiki`
Expected: both show `4.20.x` (no `UNMET` / `invalid`).

- [ ] **Step 4: Typecheck against the new package**

Run: `npm run typecheck`
Expected: PASS (no new type errors from the bump).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "fix(wiki): adopt expo-llm-wiki 4.20 transaction serialization"
```

---

## Task 2: Add `bootstrapping` initial state to `wikiMachine`

The machine currently starts in `idle`. We add a `bootstrapping` initial state that invokes a new `bootstrapOntologyActor`, then transitions to `idle`. Because the root `on` handlers already append `READ`/`WRITE`/`INGEST`/`SYNC`/`FORGET` to `pendingEvents`, and `idle`'s `entry: 'flushPending'` drains them, any event that arrives during bootstrap runs strictly **after** bootstrap resolves — the overwrite race disappears.

**Files:**
- Modify: `src/machines/wikiMachine.ts`
- Test: `__tests__/wikiMachine.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these tests inside the `describe('wikiMachine', …)` block in `__tests__/wikiMachine.test.ts`. `makeWikiMock` needs `getOntologyManifest`/`setOntologyManifest`, so extend it inline per test.

```ts
test('bootstrap: SYNC sent immediately after spawn runs only after bootstrap resolves', async () => {
  const order: string[] = []
  let resolveManifest!: (v: unknown) => void
  const wiki = makeWikiMock({
    getOntologyManifest: jest.fn(() => {
      order.push('getOntologyManifest')
      return new Promise((res) => { resolveManifest = res })
    }),
    setOntologyManifest: jest.fn().mockResolvedValue(undefined),
    exportDump: jest.fn(() => { order.push('exportDump'); return Promise.resolve({ generatedAt: 0, entities: {} }) }),
  })
  const actor = spawnAndTrack(wiki)
  // Machine starts in bootstrapping and is awaiting getOntologyManifest.
  expect(actor.getSnapshot().value).toBe('bootstrapping')
  // SYNC arrives during bootstrap — must be queued, not run yet.
  actor.send({ type: 'SYNC', runRemoteSync: jest.fn().mockResolvedValue(null) })
  expect(order).toEqual(['getOntologyManifest'])
  // Manifest missing → bootstrap writes emergent default, then idle drains the queued SYNC.
  resolveManifest(null)
  await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
  expect(order).toEqual(['getOntologyManifest', 'exportDump'])
  expect(wiki.setOntologyManifest).toHaveBeenCalledWith(
    'char1', { node_types: [], edge_types: [] }, { mode: 'emergent' },
  )
})

test('bootstrap: existing non-off manifest is left untouched', async () => {
  const wiki = makeWikiMock({
    getOntologyManifest: jest.fn().mockResolvedValue({ mode: 'strict', node_types: [], edge_types: [] }),
    setOntologyManifest: jest.fn().mockResolvedValue(undefined),
  })
  const actor = spawnAndTrack(wiki)
  await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
  expect(wiki.setOntologyManifest).not.toHaveBeenCalled()
})

test("bootstrap: mode 'off' manifest is reset to empty emergent (carried-over behavior)", async () => {
  const wiki = makeWikiMock({
    getOntologyManifest: jest.fn().mockResolvedValue({ mode: 'off', node_types: [{ name: 'x' }], edge_types: [] }),
    setOntologyManifest: jest.fn().mockResolvedValue(undefined),
  })
  const actor = spawnAndTrack(wiki)
  await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
  expect(wiki.setOntologyManifest).toHaveBeenCalledWith(
    'char1', { node_types: [], edge_types: [] }, { mode: 'emergent' },
  )
})

test('bootstrap: failure still reaches idle, reports, and processes queued events', async () => {
  const wiki = makeWikiMock({
    getOntologyManifest: jest.fn().mockRejectedValue(new Error('boom')),
    setOntologyManifest: jest.fn().mockResolvedValue(undefined),
  })
  const actor = spawnAndTrack(wiki)
  actor.send({ type: 'READ', query: 'hello' })
  await waitFor(actor, (s) => s.matches('idle'), WAIT_OPTS)
  expect(wiki.read).toHaveBeenCalledWith('char1', 'hello')
  expect(jest.mocked(reportError)).toHaveBeenCalledWith(
    expect.any(Error), 'wiki:char1:ontology:bootstrap',
  )
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- __tests__/wikiMachine.test.ts`
Expected: FAIL — machine starts in `idle` (not `bootstrapping`); `getOntologyManifest`/`bootstrap` reporting not invoked by the machine.

- [ ] **Step 3: Change the initial state and add the `bootstrapping` state**

In `src/machines/wikiMachine.ts`, change line 113 from:

```ts
    initial: 'idle',
```

to:

```ts
    initial: 'bootstrapping',
```

Then add a new `bootstrapping` state as the **first** entry inside `states: {` (immediately before `idle:` at line 145):

```ts
      bootstrapping: {
        invoke: {
          src: 'bootstrapOntologyActor',
          input: ({ context }) => ({
            wiki: context.wiki,
            entityId: context.entityId,
          }),
          onDone: { target: 'idle' },
          onError: {
            target: 'idle',
            actions: 'reportBootstrapError',
          },
        },
      },
```

- [ ] **Step 4: Add the `bootstrapOntologyActor` and `reportBootstrapError` action**

In the machine's second config object (`{ actions, guards, delays, actors }`), add the actor to the `actors: {` map (e.g. immediately after `subscribeStatus`, before `readActor` at line 376):

```ts
      bootstrapOntologyActor: fromPromise(
        async ({
          input,
        }: {
          input: { wiki: Wiki; entityId: string }
        }) => {
          const existing = await input.wiki.getOntologyManifest(input.entityId)
          if (!existing || existing.mode === 'off') {
            await input.wiki.setOntologyManifest(
              input.entityId,
              { node_types: [], edge_types: [] },
              { mode: 'emergent' },
            )
          }
        },
      ),
```

Add the action to the `actions: {` map (e.g. after `recordError` at line 324):

```ts
      reportBootstrapError: ({ context, event }) => {
        reportError(
          normalizeError((event as { error?: unknown }).error),
          `wiki:${context.entityId}:ontology:bootstrap`,
        )
      },
```

> **Reporting-path note (flag for review):** the spec names `reportWikiOpForCharacter` for bootstrap errors, but that helper is private to `src/services/characterSyncService.ts:45` and not exported. `wikiMachine` already imports and uses `reportError` (line 9, `recordError` action). Using `reportError` here keeps the machine's existing dependency surface and matches its error-reporting convention. Same non-fatal semantics as the old `console.warn`; tag `wiki:<id>:ontology:bootstrap` is preserved.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- __tests__/wikiMachine.test.ts`
Expected: PASS — all four new tests plus the pre-existing suite.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/machines/wikiMachine.ts __tests__/wikiMachine.test.ts
git commit -m "fix(wiki): order ontology bootstrap through actor bootstrapping state"
```

---

## Task 3: Remove the fire-and-forget bootstrap from `wikiOrchestrator.getOrSpawn`

Bootstrap now lives in the machine, so the orchestrator's out-of-queue block is dead and must be deleted (it would otherwise double-bootstrap and re-introduce the race).

**Files:**
- Modify: `src/services/wikiOrchestrator.ts:54-60`
- Test: `__tests__/wikiOrchestrator.test.ts`

- [ ] **Step 1: Add a test asserting the orchestrator no longer bootstraps directly**

Add to `__tests__/wikiOrchestrator.test.ts` inside the `describe('wikiOrchestrator', …)` block:

```ts
test('getOrSpawn does not itself call setOntologyManifest (machine owns bootstrap)', async () => {
  const wiki = makeWikiMock()
  wikiOrchestrator.getOrSpawn('e1', wiki as never)
  // Let any queued microtasks flush.
  await new Promise((r) => setTimeout(r, 0))
  expect(wiki.getOntologyManifest).not.toHaveBeenCalled()
})
```

> Note: `getOntologyManifest` is now called by the spawned *machine* actor, not by `getOrSpawn`. The orchestrator's `makeWikiMock` returns a fresh mock per test; this asserts the orchestrator function itself contains no bootstrap call. The machine actor started by `getOrSpawn` will call `getOntologyManifest` asynchronously — but that mock instance is only observed here right after spawn. To keep the assertion robust against the actor's own call, assert on call ordering instead:

Replace the test body's assertion with a spy that fails only if `getOrSpawn` calls it *synchronously* before returning:

```ts
test('getOrSpawn returns before any ontology bootstrap side effect', () => {
  const wiki = makeWikiMock()
  wikiOrchestrator.getOrSpawn('e1', wiki as never)
  // Synchronous check: getOrSpawn must not have fired bootstrap inline.
  expect(wiki.setOntologyManifest).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run it to verify current state**

Run: `npm test -- __tests__/wikiOrchestrator.test.ts`
Expected: The existing suite still passes; the new synchronous test also passes today (bootstrap is async `void`). This test is a **regression guard** — it locks in that `getOrSpawn` never bootstraps inline after the block is removed.

- [ ] **Step 3: Delete the fire-and-forget block**

In `src/services/wikiOrchestrator.ts`, remove lines 54-60 (the entire `void wiki.getOntologyManifest(...)...catch(...)` statement):

```ts
  void wiki.getOntologyManifest(entityId).then((existing) => {
    if (!existing || existing.mode === 'off') {
      return wiki.setOntologyManifest(entityId, { node_types: [], edge_types: [] }, { mode: 'emergent' })
    }
  }).catch((error) => {
    console.warn(`Failed to bootstrap emergent ontology mode for ${entityId}:`, error)
  })
```

The function body between `actors.set(entityId, actor)` and `return actor` should now be empty (just the blank line).

- [ ] **Step 4: Run the orchestrator tests**

Run: `npm test -- __tests__/wikiOrchestrator.test.ts`
Expected: PASS — existing suites unaffected, new guard passes.

- [ ] **Step 5: Run both affected suites together + typecheck**

Run: `npm test -- __tests__/wikiMachine.test.ts __tests__/wikiOrchestrator.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/services/wikiOrchestrator.ts __tests__/wikiOrchestrator.test.ts
git commit -m "fix(wiki): drop fire-and-forget bootstrap from getOrSpawn"
```

---

## PR 1 verification & open

- [ ] **Full client suite:** `npm test` → PASS. `npm run typecheck` → PASS. `npm run lint` → PASS.
- [ ] **Prod-mirror manual verification (required before PR 2 merges):** on the web prod-mirror, save a character with cloud sync enabled and enter the Talk tab. Confirm logs show **no** `cannot start a transaction within a transaction`, `cannot rollback - no transaction is active`, `importDump timed out`, or `Sync timeout for entity …`.
- [ ] **Open PR against `staging`** (per `docs/GIT_WORKFLOW.md`), not `main`. Title: `fix(wiki): serialize wiki transactions + order ontology bootstrap`.

---

# PR 2 — Functions: shared Vertex empty-response helper + config

## Task 4: Create the shared `vertexText.ts` helper

Lift the proven retry/logging logic from `generateReply.ts:318-409` into a shared module. The helper is caller-agnostic: the caller supplies the full `config` (systemInstruction, tokens, thinking, schema).

**Files:**
- Create: `functions/src/services/vertexText.ts`
- Create: `functions/src/services/vertexText.test.ts`

- [ ] **Step 1: Write the failing unit tests**

Create `functions/src/services/vertexText.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { HttpsError } from "firebase-functions/v2/https";
import {
  isRetryableEmptyResponseFinishReason,
  generateTextWithRetry,
  __setGenAIClientForTests,
} from "./vertexText.js";

function fakeClient(responses: unknown[]) {
  let call = 0;
  return {
    models: {
      generateContent: async () => {
        const r = responses[call] ?? responses[responses.length - 1];
        call += 1;
        return r;
      },
    },
    calls: () => call,
  };
}

const textResponse = (text: string) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }],
});
const emptyResponse = (finishReason?: string) => ({
  candidates: finishReason ? [{ content: { parts: [] }, finishReason }] : [],
});

test("isRetryableEmptyResponseFinishReason: MAX_TOKENS and SAFETY are non-retryable", () => {
  assert.equal(isRetryableEmptyResponseFinishReason("MAX_TOKENS"), false);
  assert.equal(isRetryableEmptyResponseFinishReason("SAFETY"), false);
  assert.equal(isRetryableEmptyResponseFinishReason("STOP"), true);
  assert.equal(isRetryableEmptyResponseFinishReason(undefined), true);
});

test("generateTextWithRetry: returns first non-empty candidate text", async () => {
  const client = fakeClient([textResponse("hello")]);
  __setGenAIClientForTests(client as never);
  const { text } = await generateTextWithRetry({
    model: "m", contents: "hi", config: {}, logContext: "test",
  });
  assert.equal(text, "hello");
  assert.equal(client.calls(), 1);
});

test("generateTextWithRetry: retries once on retryable empty then succeeds", async () => {
  const client = fakeClient([emptyResponse("OTHER"), textResponse("ok")]);
  __setGenAIClientForTests(client as never);
  const { text } = await generateTextWithRetry({
    model: "m", contents: "hi", config: {}, logContext: "test",
  });
  assert.equal(text, "ok");
  assert.equal(client.calls(), 2);
});

test("generateTextWithRetry: does NOT retry on non-retryable finishReason", async () => {
  const client = fakeClient([emptyResponse("SAFETY"), textResponse("never")]);
  __setGenAIClientForTests(client as never);
  await assert.rejects(
    () => generateTextWithRetry({ model: "m", contents: "hi", config: {}, logContext: "test" }),
    (e: HttpsError) => e.code === "internal",
  );
  assert.equal(client.calls(), 1);
});

test("generateTextWithRetry: throws internal HttpsError after retry still empty", async () => {
  const client = fakeClient([emptyResponse("OTHER"), emptyResponse("OTHER")]);
  __setGenAIClientForTests(client as never);
  await assert.rejects(
    () => generateTextWithRetry({ model: "m", contents: "hi", config: {}, logContext: "test" }),
    (e: HttpsError) => e.code === "internal" && e.message === "Model returned an empty response.",
  );
  assert.equal(client.calls(), 2);
});
```

- [ ] **Step 2: Build+run to verify failure**

Run (from `functions/`): `npm test`
Expected: FAIL — build error: `./vertexText.js` module not found / exports missing.

- [ ] **Step 3: Write `vertexText.ts`**

Create `functions/src/services/vertexText.ts`:

```ts
import { HttpsError } from "firebase-functions/v2/https";
import * as logger from "firebase-functions/logger";
import { GoogleGenAI } from "@google/genai";
import type { Candidate, Content, GenerateContentConfig } from "@google/genai";

// Gemini 3 family is global-only on Vertex AI.
const GEMINI_LOCATION = "global";

let genAIClient: GoogleGenAI | undefined;

/** Test seam — inject a fake client. */
export function __setGenAIClientForTests(client: GoogleGenAI | undefined): void {
  genAIClient = client;
}

export function getGenAIClient(): GoogleGenAI {
  if (genAIClient) {
    return genAIClient;
  }
  const project = [
    process.env.GCLOUD_PROJECT,
    process.env.GCP_PROJECT,
    process.env.GOOGLE_CLOUD_PROJECT,
  ]
    .map((v) => v?.trim())
    .find((v): v is string => Boolean(v));
  if (!project) {
    throw new HttpsError(
      "failed-precondition",
      "Missing project env (GCLOUD_PROJECT, GCP_PROJECT, or GOOGLE_CLOUD_PROJECT) for Vertex AI.",
    );
  }
  genAIClient = new GoogleGenAI({ vertexai: true, project, location: GEMINI_LOCATION });
  return genAIClient;
}

export const NON_RETRYABLE_EMPTY_RESPONSE_FINISH_REASONS = new Set([
  "MAX_TOKENS",
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "MALFORMED_FUNCTION_CALL",
]);

export function isRetryableEmptyResponseFinishReason(finishReason: string | undefined): boolean {
  if (!finishReason || finishReason === "FINISH_REASON_UNSPECIFIED" || finishReason === "OTHER") {
    return true;
  }
  return !NON_RETRYABLE_EMPTY_RESPONSE_FINISH_REASONS.has(finishReason);
}

function firstNonEmptyText(candidates: Candidate[]): { text: string; candidate: Candidate } | null {
  for (const candidate of candidates) {
    const parts = candidate.content?.parts ?? [];
    const text = parts
      .map((p) => (typeof p.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (text) return { text, candidate };
  }
  return null;
}

export async function generateTextWithRetry(params: {
  model: string;
  contents: Content[] | string;
  config: GenerateContentConfig;
  logContext: string;
}): Promise<{ text: string; candidate: Candidate }> {
  const ai = getGenAIClient();

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await ai.models.generateContent({
      model: params.model,
      contents: params.contents,
      config: params.config,
    });

    const candidates = result.candidates ?? [];
    const hit = firstNonEmptyText(candidates);
    if (hit) return hit;

    const finishReasons = candidates.map((c) => c.finishReason ?? null);
    const shouldRetry =
      attempt === 0 &&
      (candidates.length === 0 ||
        candidates.some((c) => isRetryableEmptyResponseFinishReason(c.finishReason)));

    if (shouldRetry) {
      logger.warn(`${params.logContext} empty model response, retrying once`, {
        finishReasons,
        candidateCount: candidates.length,
        promptFeedback: result.promptFeedback ?? null,
      });
      continue;
    }

    logger.error(
      attempt === 0
        ? `${params.logContext} model returned empty response with non-retryable finish reason`
        : `${params.logContext} model returned empty response after retry`,
      {
        finishReasons,
        candidateCount: candidates.length,
        promptFeedback: result.promptFeedback ?? null,
      },
    );
    break;
  }

  throw new HttpsError("internal", "Model returned an empty response.");
}
```

- [ ] **Step 4: Build+run to verify pass**

Run (from `functions/`): `npm test`
Expected: PASS — all five `vertexText.test.ts` tests pass; rest of suite unchanged.

> If `@google/genai` does not export `Candidate`/`Content`/`GenerateContentConfig` as named types at the installed version, import them the same way `generateReply.ts` already does (check its import block near the top) and mirror that.

- [ ] **Step 5: Commit**

```bash
git add functions/src/services/vertexText.ts functions/src/services/vertexText.test.ts
git commit -m "feat(functions): shared vertexText helper with empty-response retry+logging"
```

---

## Task 5: Adopt the helper in `summarizeText` (budget 0)

**Files:**
- Modify: `functions/src/summarizeText.ts`

- [ ] **Step 1: Add a test proving the generator retries via the helper**

The existing `summarizeText` tests inject `generateSummary` fakes at the handler seam — keep those. Add one test exercising the **real** `getSummaryGenerator` through the shared client seam. Append to `functions/src/summarizeText.test.ts` (create if absent, mirroring `wikiLlm.test.ts` conventions with `node:test`):

```ts
import { __setGenAIClientForTests } from "./services/vertexText.js";
import { getSummaryGeneratorForTests } from "./summarizeText.js";

test("summarizeText generator: retries once on retryable empty then returns text", async () => {
  let call = 0;
  __setGenAIClientForTests({
    models: {
      generateContent: async () => {
        call += 1;
        return call === 1
          ? { candidates: [{ content: { parts: [] }, finishReason: "OTHER" }] }
          : { candidates: [{ content: { parts: [{ text: "summary" }] }, finishReason: "STOP" }] };
      },
    },
  } as never);
  const gen = getSummaryGeneratorForTests();
  const out = await gen("prompt");
  assert.equal(out, "summary");
  assert.equal(call, 2);
  __setGenAIClientForTests(undefined);
});
```

- [ ] **Step 2: Build+run to verify failure**

Run (from `functions/`): `npm test`
Expected: FAIL — `getSummaryGeneratorForTests` not exported; generator still uses the private client.

- [ ] **Step 3: Replace the private client + candidate loop**

In `functions/src/summarizeText.ts`:

Remove the `import { GoogleGenAI } from "@google/genai";` line (line 4) and add:

```ts
import { generateTextWithRetry } from "./services/vertexText.js";
```

Delete `getProjectId` (lines 34-42), the `genAIClient` variable (line 89), and the entire `getGenAIClient` function (lines 92-107) — they now live in `vertexText.ts`.

Replace `getSummaryGenerator` (lines 109-141) with:

```ts
function getSummaryGenerator(): GenerateSummaryFn {
  if (summaryGenerator) {
    return summaryGenerator;
  }

  summaryGenerator = async (prompt: string): Promise<string> => {
    const { text } = await generateTextWithRetry({
      model: DEFAULT_MODEL,
      contents: prompt,
      config: {
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: SUMMARIZE_THINKING_BUDGET },
      },
      logContext: "summarizeText",
    });
    return text;
  };

  return summaryGenerator;
}

/** Test seam — exercises the real generator against the injected client. */
export function getSummaryGeneratorForTests(): GenerateSummaryFn {
  summaryGenerator = undefined;
  return getSummaryGenerator();
}
```

Add the budget constant next to `MAX_OUTPUT_TOKENS` (after line 14):

```ts
const SUMMARIZE_THINKING_BUDGET = 0; // interactive-ish compression; retry (vertexText) covers empties
```

`GEMINI_LOCATION` (line 12) is now unused here — remove it.

- [ ] **Step 4: Build+run to verify pass**

Run (from `functions/`): `npm test`
Expected: PASS — new generator test + all existing `summarizeText` tests (they inject `generateSummary`, unaffected).

- [ ] **Step 5: Typecheck**

Run (from `functions/`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/summarizeText.ts functions/src/summarizeText.test.ts
git commit -m "fix(functions): summarizeText uses shared vertexText retry helper"
```

---

## Task 6: Adopt the helper in `wikiLlm` + drop `responseSchema` + budget 1024 (Fix 3 + Fix 4 + Fix 5)

**Files:**
- Modify: `functions/src/wikiLlm.ts`

- [ ] **Step 1: Add a test for the real generator (retry + no responseSchema + budget 1024)**

Append to `functions/src/wikiLlm.test.ts`:

```ts
import { __setGenAIClientForTests } from "./services/vertexText.js";
import { getTextGeneratorForTests } from "./wikiLlm.js";

test("wikiLlm generator: no responseSchema, thinkingBudget 1024, retries once on empty", async () => {
  let call = 0;
  const seenConfigs: unknown[] = [];
  __setGenAIClientForTests({
    models: {
      generateContent: async (req: { config: unknown }) => {
        call += 1;
        seenConfigs.push(req.config);
        return call === 1
          ? { candidates: [] }
          : { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }] };
      },
    },
  } as never);
  const gen = getTextGeneratorForTests();
  const out = await gen("sys", "user");
  assert.equal(out, '{"ok":true}');
  assert.equal(call, 2);
  const cfg = seenConfigs[0] as Record<string, unknown>;
  assert.equal(cfg["responseMimeType"], "application/json");
  assert.equal("responseSchema" in cfg, false);
  assert.deepEqual(cfg["thinkingConfig"], { thinkingBudget: 1024 });
  __setGenAIClientForTests(undefined);
});
```

- [ ] **Step 2: Build+run to verify failure**

Run (from `functions/`): `npm test`
Expected: FAIL — `getTextGeneratorForTests` not exported; current config still sets `responseSchema` and `thinkingBudget: 0`.

- [ ] **Step 3: Rewrite `wikiLlm.ts` client usage**

In `functions/src/wikiLlm.ts`:

Change the import on line 4 from `import { GoogleGenAI, Type } from "@google/genai";` to remove both (no longer used) and add:

```ts
import { generateTextWithRetry } from "./services/vertexText.js";
```

Delete the `genAIClient` variable (line 69) and the whole `getGenAIClient` function (lines 71-92) — now in `vertexText.ts`. `GEMINI_LOCATION` (line 14) becomes unused — remove it.

Add budget constant next to `MAX_OUTPUT_TOKENS` (after line 15):

```ts
const WIKI_LLM_THINKING_BUDGET = 1024; // background librarian; structured JSON reasoning, quality > latency
```

Replace `getTextGenerator` (lines 94-122) with:

```ts
function getTextGenerator(model = DEFAULT_MODEL) {
  return async (systemPrompt: string, userPrompt: string): Promise<string> => {
    const { text } = await generateTextWithRetry({
      model,
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        thinkingConfig: { thinkingBudget: WIKI_LLM_THINKING_BUDGET },
        temperature: 0,
        responseMimeType: "application/json",
        // NOTE: responseSchema deliberately omitted. An object schema with no
        // properties gave constrained decoding a degenerate grammar and drove
        // empty responses. The librarian prompt (core-llm-wiki) fully specifies
        // the JSON shape and the client parses/validates it.
      },
      logContext: "wikiLlm",
    });
    return text;
  };
}

/** Test seam — exercises the real generator against the injected client. */
export function getTextGeneratorForTests(model = DEFAULT_MODEL) {
  return getTextGenerator(model);
}
```

- [ ] **Step 4: Build+run to verify pass**

Run (from `functions/`): `npm test`
Expected: PASS — new generator test + existing `wikiLlm` tests (they inject `generateText`/`getUser`/`creditService`, unaffected).

- [ ] **Step 5: Typecheck**

Run (from `functions/`): `npm run typecheck`
Expected: PASS — confirm no lingering `Type` import references.

- [ ] **Step 6: Commit**

```bash
git add functions/src/wikiLlm.ts functions/src/wikiLlm.test.ts
git commit -m "fix(functions): wikiLlm uses shared retry, drops degenerate responseSchema, budget 1024"
```

---

## Task 7: Adopt the helper in `memoryFunctions.defaultGenerateContent` (fix latent `return ''` bug + budget 1024)

**Latent bug:** `defaultGenerateContent` (lines 160-184) returns `''` on empty response instead of throwing. Empty output silently degrades heal/write-diff (callers fall back to heuristic on *thrown* errors, but a returned `''` parses to `null` → heuristic anyway for write, yet contradiction/heal passes treat `''` as "no contradictions" — masking a real failure). Fix 3 requires it to throw, which the helper does.

**Files:**
- Modify: `functions/src/memoryFunctions.ts`

- [ ] **Step 1: Add a test for the real generator**

Create/append `functions/src/memoryFunctions.test.ts` (mirror `node:test` style). If the file exists, append; otherwise create with the imports shown:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { HttpsError } from "firebase-functions/v2/https";
import { __setGenAIClientForTests } from "./services/vertexText.js";
import { defaultGenerateContentForTests } from "./memoryFunctions.js";

test("memory generateContent: throws (not '') on empty after retry; budget 1024", async () => {
  let call = 0;
  const seenConfigs: unknown[] = [];
  __setGenAIClientForTests({
    models: {
      generateContent: async (req: { config: unknown }) => {
        call += 1;
        seenConfigs.push(req.config);
        return { candidates: [{ content: { parts: [] }, finishReason: "OTHER" }] };
      },
    },
  } as never);
  await assert.rejects(
    () => defaultGenerateContentForTests("prompt"),
    (e: HttpsError) => e.code === "internal",
  );
  assert.equal(call, 2); // retried once
  assert.deepEqual((seenConfigs[0] as Record<string, unknown>)["thinkingConfig"], { thinkingBudget: 1024 });
  __setGenAIClientForTests(undefined);
});

test("memory generateContent: returns text when present", async () => {
  __setGenAIClientForTests({
    models: {
      generateContent: async () => ({
        candidates: [{ content: { parts: [{ text: "[]" }] }, finishReason: "STOP" }],
      }),
    },
  } as never);
  assert.equal(await defaultGenerateContentForTests("p"), "[]");
  __setGenAIClientForTests(undefined);
});
```

- [ ] **Step 2: Build+run to verify failure**

Run (from `functions/`): `npm test`
Expected: FAIL — `defaultGenerateContentForTests` not exported; current impl returns `''` (would not reject) and uses budget 0.

- [ ] **Step 3: Replace `defaultGenerateContent`**

In `functions/src/memoryFunctions.ts`:

Remove `import { GoogleGenAI } from '@google/genai';` (line 5) and add:

```ts
import { generateTextWithRetry } from './services/vertexText.js';
```

Delete the `genAIClient` variable (line 135) and the whole `getGenAIClient` function (lines 137-158). `GEMINI_LOCATION` (line 19) becomes unused — remove it.

Change the heal budget constant (line 21) note and add a thinking budget constant beside it:

```ts
const HEAL_MAX_OUTPUT_TOKENS = 1_024;
const HEAL_THINKING_BUDGET = 1024; // background, structured, correctness-critical: heal / write-diff / contradiction
```

Replace `defaultGenerateContent` (lines 160-184) with:

```ts
async function defaultGenerateContent(prompt: string): Promise<string> {
  const { text } = await generateTextWithRetry({
    model: HEAL_MODEL,
    contents: prompt,
    config: {
      maxOutputTokens: HEAL_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingBudget: HEAL_THINKING_BUDGET },
    },
    logContext: 'memoryHeal',
  });
  return text;
}

/** Test seam — exercises the real generator against the injected client. */
export async function defaultGenerateContentForTests(prompt: string): Promise<string> {
  return defaultGenerateContent(prompt);
}
```

> **Behavior-change note (flag for review):** `defaultGenerateContent` now **throws** `HttpsError("internal", …)` on a persistent empty response instead of returning `''`. Callers `buildWriteDiff` (line 1045) and `detectContradictions` (line 1209) already `catch` and fall back gracefully (heuristic / skip), so throwing is strictly safer than silent `''`. No caller change needed.

- [ ] **Step 4: Build+run to verify pass**

Run (from `functions/`): `npm test`
Expected: PASS — new generator tests + all existing memory tests (they inject `generateContent` via `deps`, unaffected).

- [ ] **Step 5: Typecheck**

Run (from `functions/`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/memoryFunctions.ts functions/src/memoryFunctions.test.ts
git commit -m "fix(functions): memory generateContent throws on empty (latent bug) + budget 1024"
```

---

## Task 8: Adopt the helper in `convertDocumentText` (budget 0, multimodal parts)

**Files:**
- Modify: `functions/src/convertDocumentText.ts`

- [ ] **Step 1: Add a test for the real Gemini generator**

Append to `functions/src/convertDocumentText.test.ts` (create mirroring `node:test` if absent):

```ts
import { __setGenAIClientForTests } from "./services/vertexText.js";
import { defaultGenerateFromGeminiForTests } from "./convertDocumentText.js";

test("convert generateFromGemini: retries once on empty then returns markdown", async () => {
  let call = 0;
  __setGenAIClientForTests({
    models: {
      generateContent: async () => {
        call += 1;
        return call === 1
          ? { candidates: [] }
          : { candidates: [{ content: { parts: [{ text: "# md" }] }, finishReason: "STOP" }] };
      },
    },
  } as never);
  assert.equal(await defaultGenerateFromGeminiForTests("application/pdf", "AAAA"), "# md");
  assert.equal(call, 2);
  __setGenAIClientForTests(undefined);
});
```

- [ ] **Step 2: Build+run to verify failure**

Run (from `functions/`): `npm test`
Expected: FAIL — `defaultGenerateFromGeminiForTests` not exported; uses private client.

- [ ] **Step 3: Replace the private client + loop**

In `functions/src/convertDocumentText.ts`:

Remove `import { GoogleGenAI } from '@google/genai';` (line 4) and add:

```ts
import { generateTextWithRetry } from './services/vertexText.js';
```

Delete `genAIClient` (line 48), `getProjectId` (lines 50-65), and `getGenAIClient` (lines 67-77). `GEMINI_LOCATION` (line 15) becomes unused — remove it.

Add a budget constant beside the other constants (after line 18):

```ts
const CONVERT_THINKING_BUDGET = 0; // mechanical transcription transform
```

Replace `defaultGenerateFromGemini` (lines 79-100) with:

```ts
async function defaultGenerateFromGemini(mimeType: string, base64: string): Promise<string> {
  const { text } = await generateTextWithRetry({
    model: CONVERT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [{ inlineData: { mimeType, data: base64 } }, { text: CONVERSION_PROMPT }],
      },
    ],
    config: {
      maxOutputTokens: 65_536,
      thinkingConfig: { thinkingBudget: CONVERT_THINKING_BUDGET },
    },
    logContext: 'convertDocumentText',
  });
  return text;
}

/** Test seam — exercises the real generator against the injected client. */
export async function defaultGenerateFromGeminiForTests(mimeType: string, base64: string): Promise<string> {
  return defaultGenerateFromGemini(mimeType, base64);
}
```

- [ ] **Step 4: Build+run to verify pass**

Run (from `functions/`): `npm test`
Expected: PASS — new test + existing convert tests (they inject `generateFromGemini` via `deps`, unaffected).

- [ ] **Step 5: Typecheck**

Run (from `functions/`): `npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/convertDocumentText.ts functions/src/convertDocumentText.test.ts
git commit -m "fix(functions): convertDocumentText uses shared vertexText retry helper"
```

---

## Task 9: Migrate `generateReply` to the shared client + retry predicate

`generateReply` keeps its own loop (it inspects `functionCalls` and `groundingMetadata` that the generic helper does not return), but should consume the **shared** client and retry predicate so there is one source of truth.

**Files:**
- Modify: `functions/src/generateReply.ts:280-414`

- [ ] **Step 1: Confirm existing generateReply tests cover the retry path**

Run (from `functions/`): `npm test`
Expected: PASS today. Note which existing tests exercise `getTextGenerator`'s retry/empty branches (search `generateReply.test.ts` for `empty` / `finishReason`). These are the regression guard for this refactor — do not delete them.

- [ ] **Step 2: Replace the local client + predicate with shared imports**

In `functions/src/generateReply.ts`:

Add to the import block:

```ts
import { getGenAIClient as getSharedGenAIClient, isRetryableEmptyResponseFinishReason } from "./services/vertexText.js";
```

Delete the local `genAIClient` variable and `getGenAIClient` function (the block ending at line 299 — the `new GoogleGenAI({ vertexai: true, project, location: GEMINI_LOCATION })` and its project-resolution guard, lines ~280-299). Delete the local `NON_RETRYABLE_EMPTY_RESPONSE_FINISH_REASONS` Set (lines 318-326) and the local `isRetryableEmptyResponseFinishReason` function (lines 328-333).

In `getTextGenerator` (lines 335-414), change line 345 from:

```ts
    const ai = getGenAIClient();
```

to:

```ts
    const ai = getSharedGenAIClient();
```

Leave the rest of the loop (the `functionCalls` short-circuit at 360-367, candidate text scan, `groundingMetadata` return at 379, retry/log at 384-406, final throw at 409) **unchanged** — it now references the imported `isRetryableEmptyResponseFinishReason`.

> If `GEMINI_LOCATION` / the project-resolution helper are used elsewhere in `generateReply.ts`, keep them; only remove the now-duplicated client construction and predicate. Verify with a grep before deleting.

- [ ] **Step 3: Build+run to verify pass**

Run (from `functions/`): `npm test`
Expected: PASS — generateReply's own retry/functionCall/grounding tests still green against the shared client seam. If a test previously reset generateReply's private `genAIClient`, point it at `__setGenAIClientForTests` from `vertexText.js` instead.

- [ ] **Step 4: Typecheck + lint**

Run (from `functions/`): `npm run typecheck && npm run lint`
Expected: PASS — no unused-import warnings for the removed `GoogleGenAI`/predicate.

- [ ] **Step 5: Commit**

```bash
git add functions/src/generateReply.ts functions/src/generateReply.test.ts
git commit -m "refactor(functions): generateReply consumes shared vertexText client + predicate"
```

---

## PR 2 verification & open

- [ ] **Full functions suite:** from `functions/` run `npm test` → PASS. `npm run typecheck` → PASS. `npm run lint` → PASS.
- [ ] **Grep sanity:** `grep -rn "new GoogleGenAI" functions/src` → only `functions/src/services/vertexText.ts` remains (single client construction site). Any other hit is a missed migration.
- [ ] **Manual/staging verification:** after deploy, drive `summarizeText` and `wikiLlm` (librarian run) and confirm the 500 rate drops. Confirm Cloud Logging now shows `finishReasons` / `candidateCount` / `promptFeedback` on any residual empty responses (was a blackout before).
- [ ] **Open PR against `staging`** (per `docs/GIT_WORKFLOW.md`), not `main`. Title: `fix(functions): shared Vertex empty-response retry + logging + wikiLlm config`. State in the description that PR 1 was verified on prod-mirror first.

---

## Self-Review (performed against the spec)

**Spec coverage:**
- Fix 1 (dep bump) → Task 1. ✅
- Fix 2 (`bootstrapping` state + drop `getOrSpawn` block) → Tasks 2–3; preserves `mode==='off'`→empty-emergent (Task 2 Step 1 test) and upgrades warn→`reportError` (flagged). ✅
- Fix 3 (shared `vertexText.ts` retry+logging; adopt in 5 functions; fix latent `''` bug) → Tasks 4–9; latent bug explicitly Task 7. ✅
- Fix 4 (`wikiLlm` drop `responseSchema`, keep JSON mime) → Task 6. ✅
- Fix 5 (`thinkingBudget`: 1024 for wikiLlm + memory heal; 0 for chat/summarize/convert as named constants) → Tasks 5–9, budgets are named constants. ✅
- Rollout order (PR1 → verify → PR2, target `staging`) → PR-boundary + verification sections. ✅
- Out of scope items (withExclusiveTransactionAsync, edge/cloud split, credit ledger) → untouched; refund `catch` blocks preserved in every function. ✅

**DI seams preserved:** `summarizeText.generateSummary`, `wikiLlm.generateText`, `memoryFunctions.deps.generateContent`, `convertDocumentText.deps.generateFromGemini` all unchanged; new `*ForTests` exports are additive seams for the real generators only.

**Type consistency:** `generateTextWithRetry` signature (`{ model, contents, config, logContext }` → `{ text, candidate }`) is used identically in Tasks 5–8. `isRetryableEmptyResponseFinishReason` / `getGenAIClient` reused by name in Task 9.

**Flags for reviewer:** (1) `reportError` vs spec's private `reportWikiOpForCharacter` in Task 2; (2) `memoryFunctions` now throws instead of returning `''` in Task 7 — both called out inline.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-09-backend-reliability-plan.md`.
