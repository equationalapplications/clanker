# Ontology Backfill Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After every successful wiki cloud sync, run one `runOntologyBackfill` batch per cloud character so cloud-agent-written and pre-ontology facts get `okf_type` and join the knowledge graph.

**Architecture:** Bump `@equationalapplications/core-llm-wiki` + `expo-llm-wiki` to `^4.21.0`, then add a best-effort sequential backfill loop in `syncWikiForCloud` (`src/services/characterSyncService.ts`) after `wikiOrchestrator.syncAll` succeeds. Backfill failures never fail the sync; `WikiBusyError` is swallowed silently; other errors and stalled batches (`scanned > 0 && typed === 0`) go to Crashlytics via `reportWikiOpForCharacter`.

**Tech Stack:** React Native / Expo, TypeScript, Jest (harness in `__tests__/characterSyncWiki.test.ts` with fully mocked wiki + orchestrator).

**Spec:** `docs/superpowers/specs/2026-07-14-ontology-backfill-adoption-design.md`

**Branch:** `feat/ontology-backfill-adoption` (already checked out). PRs in this repo target `staging`, not `main` (see `docs/GIT_WORKFLOW.md`).

---

## Background for the implementer

- `syncWikiForCloud` (`src/services/characterSyncService.ts:85`) is called from both `syncAllToCloud` (line ~198) and `restoreFromCloud` (line ~279). One insertion point covers both paths.
- `reportWikiOpForCharacter(err, context, characterId, summary)` (line 45) wraps `reportError` with a per-character message. Existing tag family: `wiki:<id>:ontology:read`, `wiki:<id>:ontology:write`.
- `WikiBusyError` is already imported at line 34.
- `getWiki()` returns `Wiki | null` where `Wiki = ReturnType<typeof createWiki>` — after the dep bump it includes `runOntologyBackfill(entityId, options?): Promise<OntologyBackfillResult>`.
- `OntologyBackfillResult` (from core-llm-wiki 4.21.0): `{ scanned: number; typed: number; failedValidation: number; edgesAdded: number; remaining: number; deferred: number }`.
- `__DEV__` is a React Native global; available in Jest via jest-expo.
- Test command style: `npm test -- __tests__/characterSyncWiki.test.ts` (the `test` script wraps jest with a preload).

---

### Task 1: Dependency bump to 4.21.0

**Files:**
- Modify: `package.json:42-43`
- Modify: `package-lock.json` (via `npm install`)

- [ ] **Step 1: Bump both wiki packages**

In `package.json`, change:

```json
    "@equationalapplications/core-llm-wiki": "^4.20.0",
    "@equationalapplications/expo-llm-wiki": "^4.20.0",
```

to:

```json
    "@equationalapplications/core-llm-wiki": "^4.21.0",
    "@equationalapplications/expo-llm-wiki": "^4.21.0",
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: exits 0, `package-lock.json` updated to 4.21.0 for both packages. Verify with:

Run: `npm ls @equationalapplications/core-llm-wiki @equationalapplications/expo-llm-wiki`
Expected: both show `4.21.0`.

- [ ] **Step 3: Typecheck to confirm additive upgrade**

Run: `npm run typecheck`
Expected: exits 0, no errors (4.21.0 is additive; no API breaks).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump core/expo-llm-wiki to ^4.21.0 for runOntologyBackfill"
```

---

### Task 2: Test harness — mock wiki gains `runOntologyBackfill`

The harness currently mocks the wiki instance as a bare `{}`. The backfill loop (Task 4) will call `wiki.runOntologyBackfill(char.id)` on the sync success path, so **every existing test that reaches a successful `syncAll` would crash with `TypeError: wiki.runOntologyBackfill is not a function`** once Task 4 lands. Fix the harness first, keeping all existing tests green.

**Files:**
- Modify: `__tests__/characterSyncWiki.test.ts`

- [ ] **Step 1: Add mock wiki helpers**

After the existing mock declarations at the top of `__tests__/characterSyncWiki.test.ts` (below line 6, before the `jest.mock` calls), add:

```ts
const mockRunOntologyBackfill = jest.fn()

function makeBackfillResult(overrides: Record<string, number> = {}) {
  return { scanned: 0, typed: 0, failedValidation: 0, edgesAdded: 0, remaining: 0, deferred: 0, ...overrides }
}

function makeMockWiki(overrides: Record<string, unknown> = {}) {
  return {
    runOntologyBackfill: (...args: unknown[]) => mockRunOntologyBackfill(...args),
    ...overrides,
  }
}
```

- [ ] **Step 2: Use the helper in both `beforeEach` blocks**

In `describe('syncWikiForCloud orchestration path')` (line ~96), change:

```ts
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetWiki.mockReturnValue({})
    mockSyncAll.mockResolvedValue(undefined)
  })
```

to:

```ts
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetWiki.mockReturnValue(makeMockWiki())
    mockRunOntologyBackfill.mockResolvedValue(makeBackfillResult())
    mockSyncAll.mockResolvedValue(undefined)
  })
```

In `describe('restoreFromCloud wiki sync reporting')` (line ~339), change:

```ts
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetWiki.mockReturnValue({})
  })
```

to:

```ts
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetWiki.mockReturnValue(makeMockWiki())
    mockRunOntologyBackfill.mockResolvedValue(makeBackfillResult())
  })
```

- [ ] **Step 3: Fix the two `wikiArg` assertions**

`expect(wikiArg).toEqual({})` no longer holds because the mock wiki has a method. In the test `'routes sync through wikiOrchestrator.syncAll'` (line ~131) and `'batches all cloud-linked characters into one syncAll call'` (line ~144), replace:

```ts
    expect(wikiArg).toEqual({})
```

with (both places):

```ts
    expect(wikiArg).toBe(mockGetWiki.mock.results[0].value)
```

(This asserts the exact wiki instance returned by `getWiki()` is what gets passed to `syncAll` — a stronger check than the old shape equality.)

- [ ] **Step 4: Fix the ontology-manifest test's custom mock wiki**

The test `'propagates ontology through runRemoteSync in both directions'` (line ~227) overrides the wiki mock. Change:

```ts
    mockGetWiki.mockReturnValue({
      getOntologyManifest: mockGetOntologyManifest,
      setOntologyManifest: mockSetOntologyManifest,
    })
```

to:

```ts
    mockGetWiki.mockReturnValue(makeMockWiki({
      getOntologyManifest: mockGetOntologyManifest,
      setOntologyManifest: mockSetOntologyManifest,
    }))
```

- [ ] **Step 5: Run the suite — must stay green**

Run: `npm test -- __tests__/characterSyncWiki.test.ts`
Expected: all existing tests PASS (harness change only; no behavior under test changed yet).

- [ ] **Step 6: Commit**

```bash
git add __tests__/characterSyncWiki.test.ts
git commit -m "test: mock wiki exposes runOntologyBackfill for backfill adoption"
```

---

### Task 3: Failing tests for the backfill loop

Write the full spec-mandated test set (spec §Testing, cases 1–7). They fail until Task 4 implements the loop.

**Files:**
- Modify: `__tests__/characterSyncWiki.test.ts`

- [ ] **Step 1: Add the new describe block**

Append after the `describe('syncWikiForCloud orchestration path')` block (before `describe('restoreFromCloud wiki sync reporting')`):

```ts
describe('ontology backfill after sync', () => {
  const SECOND_LOCAL_ID = 'char-local-2'
  const SECOND_CLOUD_ID = '550e8400-e29b-41d4-a716-446655440001'

  beforeEach(() => {
    jest.clearAllMocks()
    mockGetWiki.mockReturnValue(makeMockWiki())
    mockRunOntologyBackfill.mockResolvedValue(makeBackfillResult())
    mockSyncAll.mockResolvedValue(undefined)
  })

  it('runs backfill once per cloud character after successful syncAll', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([
      makeCloudChar(),
      makeCloudChar({ id: SECOND_LOCAL_ID, cloud_id: SECOND_CLOUD_ID }),
    ])

    await syncAllToCloud('user-1')

    expect(mockSyncAll).toHaveBeenCalledTimes(1)
    expect(mockRunOntologyBackfill).toHaveBeenCalledTimes(2)
    expect(mockRunOntologyBackfill).toHaveBeenNthCalledWith(1, LOCAL_ID)
    expect(mockRunOntologyBackfill).toHaveBeenNthCalledWith(2, SECOND_LOCAL_ID)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('swallows WikiBusyError from backfill and still processes remaining characters', async () => {
    const { WikiBusyError } = require('@equationalapplications/expo-llm-wiki')
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([
      makeCloudChar(),
      makeCloudChar({ id: SECOND_LOCAL_ID, cloud_id: SECOND_CLOUD_ID }),
    ])
    mockRunOntologyBackfill
      .mockRejectedValueOnce(new WikiBusyError('backfill', LOCAL_ID))
      .mockResolvedValueOnce(makeBackfillResult({ scanned: 3, typed: 3 }))

    await syncAllToCloud('user-1')

    expect(mockRunOntologyBackfill).toHaveBeenCalledTimes(2)
    expect(reportError).not.toHaveBeenCalled()
  })

  it('reports non-busy backfill errors with the backfill tag and continues', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([
      makeCloudChar(),
      makeCloudChar({ id: SECOND_LOCAL_ID, cloud_id: SECOND_CLOUD_ID }),
    ])
    mockRunOntologyBackfill
      .mockRejectedValueOnce(new Error('llm exploded'))
      .mockResolvedValueOnce(makeBackfillResult({ scanned: 1, typed: 1 }))

    await expect(syncAllToCloud('user-1')).resolves.toBeUndefined()

    expect(mockRunOntologyBackfill).toHaveBeenCalledTimes(2)
    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      `wiki:${LOCAL_ID}:ontology:backfill`,
    )
  })

  it('reports a stalled batch (scanned > 0, typed === 0) with the stalled tag', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])
    mockRunOntologyBackfill.mockResolvedValue(
      makeBackfillResult({ scanned: 5, deferred: 5, remaining: 5 }),
    )

    await syncAllToCloud('user-1')

    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      `wiki:${LOCAL_ID}:ontology:backfill:stalled`,
    )
  })

  it('reports nothing for healthy and empty backfill results', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([
      makeCloudChar(),
      makeCloudChar({ id: SECOND_LOCAL_ID, cloud_id: SECOND_CLOUD_ID }),
    ])
    mockRunOntologyBackfill
      .mockResolvedValueOnce(makeBackfillResult({ scanned: 4, typed: 2, deferred: 2 }))
      .mockResolvedValueOnce(makeBackfillResult())

    await syncAllToCloud('user-1')

    expect(reportError).not.toHaveBeenCalled()
  })

  it('skips backfill when syncAll throws a pipeline error', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])
    mockSyncAll.mockRejectedValue(new Error('network error'))

    await syncAllToCloud('user-1')

    expect(mockRunOntologyBackfill).not.toHaveBeenCalled()
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), 'wiki:sync:batch')
  })

  it('skips backfill when syncAll throws WikiBusyError', async () => {
    const { WikiBusyError } = require('@equationalapplications/expo-llm-wiki')
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])
    mockSyncAll.mockRejectedValue(new WikiBusyError('sync', LOCAL_ID))

    await syncAllToCloud('user-1')

    expect(mockRunOntologyBackfill).not.toHaveBeenCalled()
    expect(reportError).not.toHaveBeenCalled()
  })

  it('skips backfill when there are no cloud characters', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([
      makeCloudChar({ save_to_cloud: 0, cloud_id: null }),
    ])

    await syncAllToCloud('user-1')

    expect(mockRunOntologyBackfill).not.toHaveBeenCalled()
  })

  it('runs backfill through the restoreFromCloud path', async () => {
    ;(getUserCharactersFn as jest.Mock).mockResolvedValue({
      data: {
        characters: [
          {
            id: CLOUD_ID,
            name: 'Restored',
            avatar: null,
            appearance: null,
            traits: null,
            emotions: null,
            context: null,
            isPublic: false,
            createdAt: new Date(1000).toISOString(),
            updatedAt: new Date(2000).toISOString(),
            voice: null,
          },
        ],
      },
    })
    // First call: restoreFromCloud building its local map (no local chars yet).
    // Second call: syncWikiForCloud re-querying after batchInsertCharacters.
    mockGetAllCharactersIncludingDeleted
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([makeCloudChar({ id: CLOUD_ID, cloud_id: CLOUD_ID })])

    await restoreFromCloud('user-1')

    expect(mockSyncAll).toHaveBeenCalledTimes(1)
    expect(mockRunOntologyBackfill).toHaveBeenCalledTimes(1)
    expect(mockRunOntologyBackfill).toHaveBeenCalledWith(CLOUD_ID)
  })
})
```

- [ ] **Step 2: Run the new tests — verify they fail for the right reason**

Run: `npm test -- __tests__/characterSyncWiki.test.ts -t "ontology backfill after sync"`
Expected: FAIL. The positive-path tests fail on `expect(mockRunOntologyBackfill).toHaveBeenCalledTimes(...)` receiving 0 calls (loop not implemented). The skip-path tests (`skips backfill when...`) may already pass — that's fine; they pin behavior against regressions.

Do **not** commit yet — commit lands with the implementation in Task 4 so the branch never has a red HEAD.

---

### Task 4: Implement the backfill loop in `syncWikiForCloud`

**Files:**
- Modify: `src/services/characterSyncService.ts:167-177`
- Test: `__tests__/characterSyncWiki.test.ts`

- [ ] **Step 1: Add explicit `return` to the pipeline catch and append the loop**

In `syncWikiForCloud`, replace the current tail of the function:

```ts
    try {
        await wikiOrchestrator.syncAll(items, wiki, 2)
    } catch (pipelineErr) {
        if (pipelineErr instanceof WikiBusyError) {
            return
        }
        // Orchestrator-level error (e.g., timeout, internal failure).
        // Per-entity failures are surfaced via the wiki machine / actor error path.
        reportError(pipelineErr, pipelineTag)
    }
}
```

with:

```ts
    try {
        await wikiOrchestrator.syncAll(items, wiki, 2)
    } catch (pipelineErr) {
        if (pipelineErr instanceof WikiBusyError) {
            return
        }
        // Orchestrator-level error (e.g., timeout, internal failure).
        // Per-entity failures are surfaced via the wiki machine / actor error path.
        reportError(pipelineErr, pipelineTag)
        return
    }

    // Best-effort: type facts that bypassed the librarian (cloud-agent writes,
    // pre-ontology facts). One batch per sync; backlog converges across syncs.
    for (const char of cloudChars) {
        try {
            const result = await wiki.runOntologyBackfill(char.id)
            if (__DEV__) console.log(`[ontology:backfill] ${char.id}`, result)
            if (result.scanned > 0 && result.typed === 0) {
                reportWikiOpForCharacter(
                    new Error(`Backfill batch classified nothing: ${JSON.stringify(result)}`),
                    `wiki:${char.id}:ontology:backfill:stalled`,
                    char.id,
                    'Ontology backfill stalled',
                )
            }
        } catch (err) {
            if (err instanceof WikiBusyError) continue
            reportWikiOpForCharacter(err, `wiki:${char.id}:ontology:backfill`, char.id, 'Ontology backfill failed')
        }
    }
}
```

Notes for the implementer:
- The added `return` in the catch is behavior-identical today (nothing followed the `try/catch`) but guarantees backfill is skipped when the pipeline failed — no point classifying facts against an unmerged state.
- Sequential `for...of`, no concurrency: each iteration is one LLM round-trip and the wiki serializes internally.
- No `while (result.remaining > 0)` loop — spec explicitly caps at one batch per character per sync to avoid a credit burst on first sync after upgrade (Out of Scope §v1).
- The loop must never throw out of `syncWikiForCloud` — every path inside the `try` either succeeds or is caught.

- [ ] **Step 2: Run the backfill tests**

Run: `npm test -- __tests__/characterSyncWiki.test.ts -t "ontology backfill after sync"`
Expected: PASS (all 9).

- [ ] **Step 3: Run the whole file**

Run: `npm test -- __tests__/characterSyncWiki.test.ts`
Expected: PASS — new block plus all pre-existing tests.

- [ ] **Step 4: Commit**

```bash
git add src/services/characterSyncService.ts __tests__/characterSyncWiki.test.ts
git commit -m "feat: run ontology backfill per cloud character after wiki sync"
```

---

### Task 5: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Full client test suite**

Run: `npm test`
Expected: exits 0. If unrelated pre-existing failures appear, verify they also fail on the branch point (`git stash` / check `main`…`HEAD~n`) before touching anything — do not fix unrelated tests in this branch.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: exits 0.

- [ ] **Step 3: Lint**

Run: `npm run lint:check`
Expected: exits 0. If it flags only the files this branch touched, fix and amend/commit:

```bash
git add -A
git commit -m "chore: lint fixes for ontology backfill adoption"
```

- [ ] **Step 4: Finish the branch**

Use superpowers:finishing-a-development-branch. Reminder: **PR targets `staging`**, not `main` (repo git workflow). Post-merge manual verification (spec §Rollout): in dev, a character with cloud-agent-written facts gets them typed after one manual sync, and graph traversal then returns them.

---

## Self-review notes

- Spec §1 (dep bump) → Task 1. Spec §2 (trigger placement, explicit `return`) → Task 4. Spec §3/3b (single pass, stalled signal) → Task 4 code + Task 3 tests. Spec §4 (error handling) → Task 4 code + Task 3 tests. Spec §Testing cases 1–7 → Task 3 (case 5 "wiki unavailable" is already covered structurally: when `getWiki()` returns null the function returns before `syncAll`; the zero-characters case is tested explicitly). Spec §Testing "full suite, typecheck, lint" → Task 5.
- Result shape used in tests matches `OntologyBackfillResult` from core-llm-wiki 4.21.0 (`scanned`, `typed`, `failedValidation`, `edgesAdded`, `remaining`, `deferred`).
- Tag strings consistent throughout: `wiki:<id>:ontology:backfill` and `wiki:<id>:ontology:backfill:stalled`.
