# Core LLM Tools Integration (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate `@equationalapplications/core-llm-tools` into `clanker-local-adk-sandbox` by replacing the hardcoded JSON schema in `time.ts` with the shared `getCurrentTimeManifest`, proving the Consumer B architectural bridge.

**Architecture:** The sandbox acts as "Consumer B" — it spreads `getCurrentTimeManifest.schema` into `FunctionTool`, attaching backend execution logic. The core package owns the schema contract; the sandbox owns the runtime. This keeps interface and implementation separate across consumers.

**Tech Stack:** Node.js 22 (Alpine), `@google/adk` FunctionTool, `@equationalapplications/core-llm-tools`, TypeScript, Docker Compose, `tsx` for ESM test runner.

---

## Blocker

> **PR #39 is not merged.** The package `@equationalapplications/core-llm-tools@0.1.0` is not yet published to npm. **Task 1 uses a local tarball** built from the monorepo source. Once the PR merges and the package publishes, replace the tarball reference with the registry version and re-run Task 1.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Build tarball | `~/code/src/github.com/equationalapplications/expo-llm-wiki/packages/core-llm-tools/` | Produce installable artifact before PR merges |
| Modify | `functions/package.json` | Add `@equationalapplications/core-llm-tools` dependency |
| Modify | `functions/src/tools/time.ts` | Replace hardcoded schema with `getCurrentTimeManifest.schema` spread |
| Modify | `functions/tests/suite.ts` | Add Test 5 asserting name inheritance and execute() correctness |

---

### Task 1: Build and Install the Package from Local Source

The `core-llm-tools` dist is already built locally. Pack it into a tarball, copy it into the sandbox, and install it so Docker can find it.

**Files:**
- Modify: `functions/package.json`
- Create (transient): `functions/core-llm-tools-0.1.0.tgz`

- [ ] **Step 1: Pack the local package into a tarball**

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/expo-llm-wiki/packages/core-llm-tools
npm pack
```

Expected output: `core-llm-tools-0.1.0.tgz` created in the current directory.

- [ ] **Step 2: Copy the tarball into the sandbox functions directory**

```bash
cp /Users/equationalapplications/code/src/github.com/equationalapplications/expo-llm-wiki/packages/core-llm-tools/core-llm-tools-0.1.0.tgz \
   /Users/equationalapplications/code/src/github.com/equationalapplications/clanker-local-adk-sandbox/functions/
```

- [ ] **Step 3: Install the tarball**

Run from `clanker-local-adk-sandbox/functions/`:

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/clanker-local-adk-sandbox/functions
npm install ./core-llm-tools-0.1.0.tgz
```

Expected: `package.json` now contains `"@equationalapplications/core-llm-tools": "file:core-llm-tools-0.1.0.tgz"` in `dependencies`.

- [ ] **Step 4: Verify the package resolves correctly**

```bash
node -e "import('@equationalapplications/core-llm-tools').then(m => console.log(Object.keys(m)))"
```

Expected output: `[ 'buildAuthorizedSchemaArray', 'getCurrentTimeManifest', 'escalateToCloudManifest' ]`

- [ ] **Step 5: Rebuild Docker container with updated dependencies**

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/clanker-local-adk-sandbox
docker compose down && docker compose build && docker compose up -d
```

Expected: Container starts cleanly. Check with `docker compose logs agent --tail=20`.

- [ ] **Step 6: Commit the dependency addition**

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/clanker-local-adk-sandbox/functions
git add package.json package-lock.json core-llm-tools-0.1.0.tgz
git commit -m "feat(deps): install @equationalapplications/core-llm-tools from local tarball"
```

---

### Task 2: Refactor the Time Tool

Replace the hardcoded `name`, `description`, and `parameters` in `time.ts` with a spread of `getCurrentTimeManifest.schema`. The `execute` body is unchanged in behavior; only the output format becomes more human-readable per spec.

**Files:**
- Modify: `functions/src/tools/time.ts`

**Current state of `functions/src/tools/time.ts`:**
```typescript
import { FunctionTool } from '@google/adk';

export const getCurrentTimeTool = new FunctionTool({
  name: 'get_current_time',
  description:
    'Get the current date and time. Always call this tool first if the user asks you to set a reminder, schedule a task, or asks about the current date/time, so you can accurately resolve temporal words like "today", "tomorrow", or "next week".',
  parameters: {
    type: 'object' as any,
    properties: {} as any,
    required: [] as any,
  },
  execute: async (): Promise<string> => {
    return new Date().toISOString();
  },
});
```

- [ ] **Step 1: Replace `functions/src/tools/time.ts` with the manifest-driven version**

```typescript
import { FunctionTool } from '@google/adk';
import { getCurrentTimeManifest } from '@equationalapplications/core-llm-tools';

export const getCurrentTimeTool = new FunctionTool({
  ...(getCurrentTimeManifest.schema as any),
  execute: async (): Promise<string> => {
    return new Date().toLocaleString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  },
});
```

> **Note on `as any`:** `AgentToolSchema.parameters.type` is typed as `'object' | 'string' | ...` (a string literal union), but `@google/adk`'s `FunctionTool` constructor expects a slightly different schema shape. The `as any` cast on the spread sidesteps the mismatch without changing runtime behavior. Once `@google/adk` or the shared types align, remove the cast.

- [ ] **Step 2: Run TypeScript type check to confirm no errors**

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/clanker-local-adk-sandbox/functions
npx tsc --noEmit
```

Expected: No errors. If there are errors related to `FunctionTool` constructor shape, add `as any` to the specific offending field (not the whole spread).

---

### Task 3: Add Integration Test

Add Test 5 to `functions/tests/suite.ts` immediately before `await teardown()`. The test verifies two things: (1) the `name` property was inherited from the manifest, not hardcoded; (2) `execute()` runs and returns a non-empty string.

**Files:**
- Modify: `functions/tests/suite.ts`

- [ ] **Step 1: Add the import for `getCurrentTimeTool` at the top of `functions/tests/suite.ts`**

After the existing imports, add:

```typescript
import { getCurrentTimeTool } from '../src/tools/time.js';
```

The full import block becomes:

```typescript
import assert from 'node:assert/strict';
import { wikiMemory } from '../src/db/wiki.js';
import { createTaskTool } from '../src/tools/tasks.js';
import { tasks } from '../src/store/tasks.js';
import { buildBaseInstruction } from '../src/agent.js';
import { TEST_CHARACTER } from '../src/config/seed.js';
import { getCurrentTimeTool } from '../src/tools/time.js';
```

- [ ] **Step 2: Add Test 5 before `await teardown()` in `runTests()`**

Find the line `await teardown();` at the bottom of `runTests()` (right before `console.log('=== All tests passed ===')`) and insert Test 5 before it:

```typescript
  // --- Test 5: Shared Schema Implementation (Core Tools) ---
  console.log('Test 5: Shared Schema Implementation (Core Tools)...');

  assert(
    (getCurrentTimeTool as any).name === 'get_current_time',
    `Expected tool name inherited from manifest, got: ${(getCurrentTimeTool as any).name}`
  );

  const timeResult = await (getCurrentTimeTool as any).execute({});

  assert(
    typeof timeResult === 'string' && timeResult.length > 0,
    'Expected execute() to return a valid localized time string'
  );

  console.log('  PASS: getCurrentTimeTool successfully wrapped the core monorepo manifest\n');
```

The updated end of `runTests()` looks like:

```typescript
  // --- Test 3: Character Context Injection ---
  // ... (unchanged)

  // --- Test 5: Shared Schema Implementation (Core Tools) ---
  console.log('Test 5: Shared Schema Implementation (Core Tools)...');

  assert(
    (getCurrentTimeTool as any).name === 'get_current_time',
    `Expected tool name inherited from manifest, got: ${(getCurrentTimeTool as any).name}`
  );

  const timeResult = await (getCurrentTimeTool as any).execute({});

  assert(
    typeof timeResult === 'string' && timeResult.length > 0,
    'Expected execute() to return a valid localized time string'
  );

  console.log('  PASS: getCurrentTimeTool successfully wrapped the core monorepo manifest\n');

  await teardown();
  console.log('=== All tests passed ===');
```

- [ ] **Step 3: Run the test suite locally (outside Docker) to verify**

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/clanker-local-adk-sandbox/functions
npm run test:integration
```

Expected output (relevant lines):
```
Test 5: Shared Schema Implementation (Core Tools)...
  PASS: getCurrentTimeTool successfully wrapped the core monorepo manifest

=== All tests passed ===
```

- [ ] **Step 4: Run the test suite inside Docker to verify container parity**

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/clanker-local-adk-sandbox
docker compose exec agent npm run test:integration
```

Expected: same output as Step 3.

---

### Task 4: Final Commit

- [ ] **Step 1: Commit the refactored tool and test**

```bash
cd /Users/equationalapplications/code/src/github.com/equationalapplications/clanker-local-adk-sandbox/functions
git add src/tools/time.ts tests/suite.ts
git commit -m "feat(tools): integrate @equationalapplications/core-llm-tools for time schema"
```

---

## Post-Merge Cleanup (After PR #39 Merges)

When `@equationalapplications/core-llm-tools` publishes to npm:

1. Remove the tarball: `git rm functions/core-llm-tools-0.1.0.tgz`
2. Install from registry: `cd functions && npm install @equationalapplications/core-llm-tools`
3. Verify `package.json` shows `"@equationalapplications/core-llm-tools": "^0.1.0"` (not `file:...`)
4. Rebuild Docker: `docker compose down && docker compose build && docker compose up -d`
5. Re-run tests to confirm parity
6. Commit: `git add package.json package-lock.json && git commit -m "chore(deps): switch core-llm-tools to registry version"`

---

## Self-Review

**Spec coverage:**
- Install package → Task 1 ✓
- Restart Docker → Task 1 Step 5 ✓
- Refactor `time.ts` → Task 2 ✓
- Add Test 5 → Task 3 ✓
- Commit → Task 4 ✓
- PR not merged blocker → addressed via tarball in Task 1 ✓

**Placeholder scan:** No TBDs, no "add appropriate error handling", all code blocks are complete.

**Type consistency:** `getCurrentTimeTool` used consistently. `(getCurrentTimeTool as any).name` and `(getCurrentTimeTool as any).execute({})` match across Task 3 Steps 1 and 2.
