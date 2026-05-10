# LLM Wiki Spec Alignment (P1–P3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the existing Phase 1–3 implementation with the revised spec (`docs/superpowers/specs/2026-05-09-llm-wiki-state-machine-design.md`), closing gaps where code drifted from spec intent.

**Architecture:** These are targeted fixes — no structural changes. Replace remaining `console.warn` in wiki-adjacent error paths with `reportError`, replace `useCharacterWikiSync` direct-export path in the character edit screen with `useCharacterWiki.sync()`, and batch the `syncWikiForCloud` loop into a single `syncAll` call. Each task is independently shippable.

**Tech Stack:** React Native (Expo), XState v5, `@equationalapplications/expo-llm-wiki@4.1.0`, Jest.

**Spec:** `docs/superpowers/specs/2026-05-09-llm-wiki-state-machine-design.md`

---

## File Structure

**Modify**
- `src/services/aiChatService.ts` — replace `console.warn` on observation write errors with `reportError`
- `src/services/characterSyncService.ts` — (a) replace wiki-related `console.warn` with `reportError`; (b) batch `syncWikiForCloud` into single `syncAll` call
- `src/hooks/useCharacterWiki.ts` — delete `useCharacterWikiSync` export
- `app/(drawer)/(tabs)/characters/[id]/edit.tsx` — switch from `useCharacterWikiSync` to `useCharacterWiki`

**Test**
- `__tests__/useAIChat.test.tsx` — verify observation write errors go through `reportError`
- `__tests__/characterSyncWiki.test.ts` — verify `syncAll` is called once with all items (not per-character)
- `__tests__/chatComposer.test.tsx` — no changes expected; verify still passes

---

### Task 1: Replace `console.warn` with `reportError` in `aiChatService.ts`

P2c scope was "replace `console.warn('[wiki]…')` with `reportError`" but `aiChatService.ts` still has two `console.warn('Failed to write observation:')` calls in the `onWriteObservation` error path.

**Files:**
- Modify: `src/services/aiChatService.ts:395-403`
- Test: `__tests__/useAIChat.test.tsx`

- [ ] **Step 1: Write test asserting `reportError` is called on observation write failure**

In `__tests__/useAIChat.test.tsx`, find the existing test for observation write errors (or add one). The test should assert that when `onWriteObservation` rejects, `reportError` is called instead of `console.warn`.

Check if there's already a test covering this path:

```bash
npx jest --listTests 2>&1 | xargs grep -l 'observation' 2>/dev/null
```

Then add or update the assertion:

```ts
expect(reportError).toHaveBeenCalledWith(
  expect.any(Error),
  'wiki:write',
)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/useAIChat.test.tsx --no-coverage -t 'observation'
```

Expected: FAIL — `reportError` not called from `aiChatService.ts` path (the hook-level catch already calls it, but the service-level `console.warn` does not).

Note: if the hook-level `characterWiki.write(...).catch(...)` in `useAIChat.ts` already handles the error before it reaches `aiChatService.ts`, the `console.warn` in `aiChatService.ts` is dead code. In that case, the right fix is to remove the `console.warn` entirely and confirm the test passes. Verify by reading the call flow: `useAIChat.ts` line 48 catches the rejection with `reportError` before `aiChatService.ts` line 399 would fire.

- [ ] **Step 3: Replace `console.warn` with `reportError` in `aiChatService.ts`**

In `src/services/aiChatService.ts`, replace the two `console.warn('Failed to write observation:', ...)` calls (lines ~399 and ~402):

```ts
// Before (line ~396-403):
try {
  void Promise.resolve(
    options.onWriteObservation(character.id, chunk || userMessage.text),
  ).catch((observationError) => {
    console.warn('Failed to write observation:', observationError)
  })
} catch (observationError) {
  console.warn('Failed to write observation:', observationError)
}

// After:
try {
  void Promise.resolve(
    options.onWriteObservation(character.id, chunk || userMessage.text),
  ).catch((observationError) => {
    if (!(observationError instanceof WikiBusyError)) {
      reportError(observationError, 'wiki:write:observation')
    }
  })
} catch (observationError) {
  if (!(observationError instanceof WikiBusyError)) {
    reportError(observationError, 'wiki:write:observation')
  }
}
```

Add imports at the top of `aiChatService.ts`:

```ts
import { WikiBusyError } from '@equationalapplications/expo-llm-wiki'
import { reportError } from '~/utilities/reportError'
```

(Check if these imports already exist before adding duplicates.)

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/useAIChat.test.tsx --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/aiChatService.ts __tests__/useAIChat.test.tsx
git commit -m "fix(wiki): replace console.warn with reportError in observation write path"
```

---

### Task 2: Replace wiki-related `console.warn` in `characterSyncService.ts`

P2c scope included wiki error reporting, but `characterSyncService.ts` still uses `console.warn` for several wiki-adjacent failures.

**Files:**
- Modify: `src/services/characterSyncService.ts:240,280,382`
- Test: `__tests__/characterSyncWiki.test.ts`

The three remaining `console.warn` calls to evaluate:

1. **Line 240** `console.warn('[restoreFromCloud] Wiki sync for restored characters failed:', error)` — this is a wiki sync failure during restore. Should use `reportError`.
2. **Line 280** `console.warn('Failed to sync character to cloud:', char.id, error.message)` — character metadata sync failure (not wiki-specific). Out of P2c scope but still a gap — should use `reportError`.
3. **Line 382** `console.warn('Failed to delete character from cloud:', char.id, error.message)` — cloud deletion failure. Out of P2c scope but should use `reportError`.

Line 78 (`console.warn('Failed to persist last sync time:')`) and line 95 (`console.warn('[syncWikiForCloud] wiki unavailable')`) are intentionally not `reportError` — they are expected/benign conditions. Leave them.

- [ ] **Step 1: Write test asserting `reportError` on restore wiki sync failure**

In `__tests__/characterSyncWiki.test.ts`, add a test:

```ts
it('reports error via reportError when wiki sync fails during restore', async () => {
  // Mock syncAll to reject
  // Call restoreFromCloud with cloud-linked characters
  // Assert reportError was called with the error and 'wiki:sync:restore'
})
```

Check existing test structure first:

```bash
head -50 __tests__/characterSyncWiki.test.ts
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/characterSyncWiki.test.ts --no-coverage -t 'restore'
```

Expected: FAIL

- [ ] **Step 3: Replace `console.warn` with `reportError`**

In `src/services/characterSyncService.ts`:

**Line 240** — replace:
```ts
// Before:
console.warn('[restoreFromCloud] Wiki sync for restored characters failed:', error)

// After:
reportError(error, 'wiki:sync:restore')
```

**Line 280** — replace:
```ts
// Before:
console.warn('Failed to sync character to cloud:', char.id, error.message)

// After:
reportWikiOpForCharacter(error, 'characterSync:upload', char.id, 'Character cloud sync')
```

**Line 382** — replace:
```ts
// Before:
console.warn('Failed to delete character from cloud:', char.id, error.message)

// After:
reportWikiOpForCharacter(error, 'characterSync:delete', char.id, 'Character cloud deletion')
```

Note: `reportWikiOpForCharacter` is already defined in the file (line 38) and `reportError` is already imported (line 16).

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/characterSyncWiki.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/characterSyncService.ts __tests__/characterSyncWiki.test.ts
git commit -m "fix(wiki): replace remaining console.warn with reportError in sync service"
```

---

### Task 3: Migrate character edit screen from `useCharacterWikiSync` to `useCharacterWiki`

The spec says Phase 3 should have replaced all direct package-hook usage. `useCharacterWikiSync` in `app/(drawer)/(tabs)/characters/[id]/edit.tsx` bypasses the orchestrator, calling `wiki.exportDump`/`wiki.importDump` directly.

**Files:**
- Modify: `app/(drawer)/(tabs)/characters/[id]/edit.tsx`
- Modify: `src/hooks/useCharacterWiki.ts` (delete `useCharacterWikiSync`)
- Test: existing tests for the edit screen (if any) or manual verification

- [ ] **Step 1: Read the character edit screen to understand `useCharacterWikiSync` usage**

```bash
# Understand the full usage pattern
```

Read `app/(drawer)/(tabs)/characters/[id]/edit.tsx` and find:
1. Where `useCharacterWikiSync` is imported (line 32)
2. Where `sync` and `isPending` are destructured (line 50)
3. Where `sync` is called — likely `wikiSyncHandler(characterId, cloudEntityId)` somewhere

- [ ] **Step 2: Replace `useCharacterWikiSync` with `useCharacterWiki` in edit screen**

Change the import:

```ts
// Before:
import { useCharacterWikiSync } from '~/hooks/useCharacterWiki'

// After:
import { useCharacterWiki } from '~/hooks/useCharacterWiki'
```

Replace the hook usage. The current `useCharacterWikiSync` returns `{ sync: (entityId, cloudEntityId) => Promise<{success, message}>, isPending }`. The `useCharacterWiki(entityId)` hook returns `{ sync: (cloudEntityId) => Promise<{success, message}>, isBusy, ... }`.

```ts
// Before:
const { sync: wikiSyncHandler, isPending: isWikiSyncingToCloud } = useCharacterWikiSync()

// After:
const { sync: wikiSyncHandler, isBusy: isWikiSyncingToCloud } = useCharacterWiki(id!)
```

Then update the call site. Find where `wikiSyncHandler(characterId, cloudEntityId)` is called and change to `wikiSyncHandler(cloudEntityId)` (since `useCharacterWiki` already has the entityId bound).

Search for the call:
```bash
grep -n 'wikiSyncHandler' app/\(drawer\)/\(tabs\)/characters/\[id\]/edit.tsx
```

Update the call:
```ts
// Before:
wikiSyncHandler(id, cloudId)

// After:
wikiSyncHandler(cloudId)
```

- [ ] **Step 3: Run typecheck to verify the edit screen compiles**

```bash
npm run typecheck
```

Expected: PASS (or baseline failures unrelated to this change)

- [ ] **Step 4: Delete `useCharacterWikiSync` from `useCharacterWiki.ts`**

Remove the entire `useCharacterWikiSync` function (lines 154–211 of `src/hooks/useCharacterWiki.ts`). Also remove any imports that become unused after the deletion (e.g., `WikiBusyError` if only used there — but check, it may be used elsewhere in the file).

Check if `WikiBusyError` is used in the `sync` method of `useCharacterWiki`:

```bash
grep 'WikiBusyError' src/hooks/useCharacterWiki.ts
```

If `WikiBusyError` is used in both `useCharacterWiki.sync()` and `useCharacterWikiSync`, the import stays. If only in `useCharacterWikiSync`, remove it.

Also check that `MemoryDump` import is still needed:

```bash
grep 'MemoryDump' src/hooks/useCharacterWiki.ts
```

If `MemoryDump` is only used in the `sync` method of `useCharacterWiki` (line ~103-128) and `useCharacterWikiSync` (line ~168-196), keep the import since `useCharacterWiki.sync` still needs it.

- [ ] **Step 5: Run tests**

```bash
npm run test --no-coverage
```

Expected: PASS. If any test imports `useCharacterWikiSync`, update it to use `useCharacterWiki` instead.

- [ ] **Step 6: Commit**

```bash
git add app/\(drawer\)/\(tabs\)/characters/\[id\]/edit.tsx src/hooks/useCharacterWiki.ts
git commit -m "refactor(wiki): migrate edit screen to useCharacterWiki, delete useCharacterWikiSync"
```

---

### Task 4: Batch `syncWikiForCloud` into single `syncAll` call

The spec's Phase 3 description says `syncWikiForCloud` routes through `wikiOrchestrator.syncAll`. The current implementation does this, but calls `syncAll` once per character in a sequential loop (concurrency=1 per call). The spec's P4a envisions batching all cloud-linked characters into a single `syncAll` call. Since P3 already routes through the orchestrator, the remaining delta is just batching — do it now to align P3 with the spec intent.

**Files:**
- Modify: `src/services/characterSyncService.ts:85-147`
- Test: `__tests__/characterSyncWiki.test.ts`

- [ ] **Step 1: Write test asserting `syncAll` is called once with all cloud-linked characters**

In `__tests__/characterSyncWiki.test.ts`, add:

```ts
it('calls syncAll once with all cloud-linked characters', async () => {
  // Setup: 3 cloud-linked characters
  // Call syncWikiForCloud
  // Assert wikiOrchestrator.syncAll was called exactly once
  // Assert the items array has 3 entries with correct entityIds
})
```

Check the existing test file structure first to match patterns:

```bash
head -80 __tests__/characterSyncWiki.test.ts
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx jest __tests__/characterSyncWiki.test.ts --no-coverage -t 'calls syncAll once'
```

Expected: FAIL — currently `syncAll` is called N times (once per character)

- [ ] **Step 3: Rewrite `syncWikiForCloud` to batch all characters**

Replace the per-character loop in `src/services/characterSyncService.ts` (lines 85–147):

```ts
async function syncWikiForCloud(localUserId: string): Promise<void> {
    const localChars = await getAllCharactersIncludingDeleted(localUserId)
    const cloudChars = localChars.filter(
        (c) => c.save_to_cloud && c.cloud_id && UUID_REGEX.test(c.cloud_id) && !c.deleted_at
    )
    if (cloudChars.length === 0) return

    const wiki = getWiki()
    if (!wiki) {
        console.warn('[syncWikiForCloud] wiki unavailable — skipping wiki sync for all characters')
        return
    }

    const items = cloudChars.map((char) => {
        const cloudId = char.cloud_id!
        return {
            entityId: char.id,
            runRemoteSync: async (localDump: MemoryDump) => {
                const localBundle = localDump.entities[char.id] ?? { facts: [], tasks: [], events: [] }
                const cloudDump: MemoryDump = {
                    generatedAt: localDump.generatedAt,
                    entities: {
                        [cloudId]: {
                            facts: localBundle.facts.map((f) => ({ ...f, entity_id: cloudId })),
                            tasks: localBundle.tasks.map((t) => ({ ...t, entity_id: cloudId })),
                            events: localBundle.events.map((e) => ({ ...e, entity_id: cloudId })),
                        },
                    },
                }
                const result = await wikiSync({ dump: cloudDump })
                const remoteDump = result.data?.remoteDump
                if (!remoteDump) {
                    throw new Error('wikiSync returned without remoteDump in response data')
                }
                return {
                    generatedAt: remoteDump.generatedAt,
                    entities: {
                        [char.id]: remoteDump.entities[cloudId] ?? { facts: [], tasks: [], events: [] },
                    },
                }
            },
        }
    })

    try {
        await wikiOrchestrator.syncAll(items, wiki, 1)
    } catch (err) {
        if (err instanceof WikiBusyError) return
        for (const char of cloudChars) {
            reportWikiOpForCharacter(err, 'wiki:sync', char.id, 'Wiki cloud sync')
        }
    }
}
```

Key changes:
- Build `items` array upfront with all cloud-linked characters
- Single `syncAll` call with `concurrency=1` (keeps sequential behavior; P4a will bump to 2)
- Error handling moves to a single catch block; each character gets a `reportError` call for traceability

- [ ] **Step 4: Run tests**

```bash
npx jest __tests__/characterSyncWiki.test.ts --no-coverage
```

Expected: PASS

- [ ] **Step 5: Run full test suite**

```bash
npm run test
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/services/characterSyncService.ts __tests__/characterSyncWiki.test.ts
git commit -m "refactor(wiki): batch syncWikiForCloud into single syncAll call"
```

---

### Task 5: Verification

- [ ] **Step 1: Run typecheck**

```bash
npm run typecheck
```

Expected: PASS (or baseline failures only)

- [ ] **Step 2: Run lint**

```bash
npm run lint
```

Expected: PASS

- [ ] **Step 3: Run full tests**

```bash
npm run test
```

Expected: PASS

- [ ] **Step 4: Verify no remaining `console.warn` in wiki paths**

```bash
grep -rn 'console\.warn' src/services/aiChatService.ts src/hooks/useCharacterWiki.ts src/machines/wikiMachine.ts src/services/wikiOrchestrator.ts
```

Expected: No matches in these files.

```bash
grep -rn 'console\.warn.*wiki\|console\.warn.*observation\|console\.warn.*memory' src/ --include='*.ts' --include='*.tsx' -i
```

Expected: Only the intentional `console.warn('[syncWikiForCloud] wiki unavailable')` in `characterSyncService.ts` (expected during bootstrap).

- [ ] **Step 5: Verify `useCharacterWikiSync` is fully removed**

```bash
grep -rn 'useCharacterWikiSync' src/ app/ __tests__/
```

Expected: No matches.

- [ ] **Step 6: Update spec if any deviation occurred**

If any task above required a different approach than described, update the Phase 1/2/3 implementation notes in `docs/superpowers/specs/2026-05-09-llm-wiki-state-machine-design.md` with a brief note.

---

## Suggested Commit Sequence

1. `fix(wiki): replace console.warn with reportError in observation write path`
2. `fix(wiki): replace remaining console.warn with reportError in sync service`
3. `refactor(wiki): migrate edit screen to useCharacterWiki, delete useCharacterWikiSync`
4. `refactor(wiki): batch syncWikiForCloud into single syncAll call`
