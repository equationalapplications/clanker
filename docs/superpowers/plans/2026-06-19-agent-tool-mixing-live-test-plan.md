# Live Tool-Mixing Integration Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual/local-only `node:test` integration test that runs a dual-intent prompt through the real `buildAgent` + `InMemoryRunner` path against the live Vertex AI endpoint, proving `GOOGLE_SEARCH` and a custom `FunctionTool` can be registered together and both get invoked in one turn.

**Architecture:** Export the already-implemented `runAgentReal` from `cloud-agent/src/index.ts` (currently module-private) with zero behavior change, then add a new test file `cloud-agent/src/agent.live.test.ts` that imports it and calls it with a prompt needing both `get_current_time` and `google_search`. The test is skipped by default via `node:test`'s per-test `skip` option, gated on `process.env.RUN_LIVE_TESTS`. A new `test:live` npm script sets that env var and reuses the existing build+glob test pipeline.

**Tech Stack:** TypeScript, `node:test` / `node:assert/strict`, `@google/adk` (`InMemoryRunner`, `LlmAgent`, `FunctionTool`, `GOOGLE_SEARCH`), existing `tsc` build → `dist/**/*.test.js` glob.

---

## File Structure

- Modify: `cloud-agent/src/index.ts:218` — change `async function runAgentReal(...)` to `export async function runAgentReal(...)`. No other change.
- Create: `cloud-agent/src/agent.live.test.ts` — new live integration test, skipped by default.
- Modify: `cloud-agent/package.json` — add `"test:live"` script.

No other files change. `agent.ts` and tool files are untouched (per spec's "Out of scope").

---

### Task 1: Export `runAgentReal` from index.ts

**Files:**
- Modify: `cloud-agent/src/index.ts:218`

- [ ] **Step 1: Confirm current signature**

Read `cloud-agent/src/index.ts:218` and confirm it currently reads:

```ts
async function runAgentReal(params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> {
```

- [ ] **Step 2: Export the function**

Change line 218 in `cloud-agent/src/index.ts` from:

```ts
async function runAgentReal(params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> {
```

to:

```ts
export async function runAgentReal(params: RunAgentParams): Promise<{ reply: string; toolCalls: string[] }> {
```

Do not change anything else in the function body or file.

- [ ] **Step 3: Typecheck and build**

Run: `cd cloud-agent && npm run build`
Expected: build succeeds with no new errors (adding `export` to an already-correctly-typed function cannot introduce type errors).

- [ ] **Step 4: Run existing test suite to confirm no regression**

Run: `cd cloud-agent && npm test`
Expected: all existing tests pass (this change is a no-op for runtime behavior — `runAgentReal` was already called from within the same module via `runAgentFn` wiring elsewhere in `index.ts`; exporting it doesn't change any caller).

- [ ] **Step 5: Commit**

```bash
cd cloud-agent && git add src/index.ts
git commit -m "refactor: export runAgentReal for live integration test reuse"
```

---

### Task 2: Add the live tool-mixing test file

**Files:**
- Create: `cloud-agent/src/agent.live.test.ts`

- [ ] **Step 1: Write the test file**

Create `cloud-agent/src/agent.live.test.ts` with exactly this content:

```ts
import assert from 'node:assert/strict'
import test from 'node:test'
import type { DrizzleClient } from './db/client.js'

const { runAgentReal } = await import('./index.js')

const mockDb = {} as unknown as DrizzleClient
const mockEmbed = async (_text: string): Promise<number[]> => [0.1, 0.2]

test(
  'runAgentReal: mixes GOOGLE_SEARCH and a custom FunctionTool in one live turn',
  { skip: !process.env.RUN_LIVE_TESTS && 'set RUN_LIVE_TESTS=1 to run against live Vertex AI', timeout: 30_000 },
  async () => {
    const { reply, toolCalls } = await runAgentReal({
      db: mockDb,
      userId: 'live-test-user',
      characterId: 'live-test-character',
      systemInstruction: 'You are a helpful assistant.',
      message: 'What time is it right now, and what is the current weather in New York?',
      history: [],
      timezone: 'America/New_York',
      embed: mockEmbed,
    })

    assert.ok(toolCalls.includes('get_current_time'), 'expected get_current_time to be called')
    assert.ok(toolCalls.includes('google_search'), 'expected google_search to be called')
    assert.ok(reply.trim().length > 0, 'expected a non-empty final reply')
  },
)
```

This matches `cloud-agent/src/agent.test.ts`'s import/mock conventions (`node:assert/strict`, `node:test`, dynamic `await import`, `mockDb`/`mockEmbed` shape).

- [ ] **Step 2: Build and confirm the test is skipped by default**

Run: `cd cloud-agent && npm test`
Expected: build succeeds; test output includes the new test name with a `skipped` status (no `RUN_LIVE_TESTS` env var set in this run), and the rest of the suite still passes. No network calls are made.

- [ ] **Step 3: Commit**

```bash
cd cloud-agent && git add src/agent.live.test.ts
git commit -m "test: add live tool-mixing integration test for GOOGLE_SEARCH + custom FunctionTool"
```

---

### Task 3: Add the `test:live` npm script

**Files:**
- Modify: `cloud-agent/package.json:8-13`

- [ ] **Step 1: Add the script**

In `cloud-agent/package.json`, the `"scripts"` block currently reads:

```json
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/cloud-agent/src/index.js",
    "typecheck": "tsc --noEmit",
    "test": "NODE_ENV=test npm run build && NODE_ENV=test node --test --test-reporter spec \"dist/**/*.test.js\""
  },
```

Change it to:

```json
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/cloud-agent/src/index.js",
    "typecheck": "tsc --noEmit",
    "test": "NODE_ENV=test npm run build && NODE_ENV=test node --test --test-reporter spec \"dist/**/*.test.js\"",
    "test:live": "RUN_LIVE_TESTS=1 npm test"
  },
```

- [ ] **Step 2: Verify the script is valid JSON and runnable**

Run: `cd cloud-agent && node -e "require('./package.json').scripts['test:live']"`
Expected: no error (confirms valid JSON).

Do NOT run `npm run test:live` here — it requires real GCP credentials (ADC or `GOOGLE_APPLICATION_CREDENTIALS`) and live network access to Vertex AI, and will make a real billed API call. Only run it manually, outside this plan's execution, once credentials are confirmed available.

- [ ] **Step 3: Commit**

```bash
cd cloud-agent && git add package.json
git commit -m "chore: add test:live npm script for live tool-mixing test"
```

---

## Manual verification (not part of automated CI, run by a human with GCP credentials)

After Task 3 is committed, a human with ADC or `GOOGLE_APPLICATION_CREDENTIALS` configured and Vertex AI project env vars set (same as running `cloud-agent` locally) can run:

```bash
cd cloud-agent && npm run test:live
```

Expected: the previously-skipped test now executes a real call to `gemini-3-flash-preview` via Vertex AI, and passes — asserting both `get_current_time` and `google_search` appear in `toolCalls`, and `reply` is non-empty. If Vertex AI rejects the tool-mixing payload (HTTP 400, the regression this test exists to catch), `runAgentReal` throws and the test fails loudly — this is the intended failure mode, no special-casing needed.
