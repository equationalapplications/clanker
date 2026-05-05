# expo-llm-wiki v2.6.0 Retrieval Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump `@equationalapplications/expo-llm-wiki` to v2.6.0 and add `preFilterLimit: 300` + `hybridWeight: 0.7` to the `WikiConfig` in `wikiService.ts`.

**Architecture:** Two isolated changes — a dependency version bump and two new optional fields in an existing config object. The v2.6.0 package ships a lazy SQLite migration (adds `embedding_blob BLOB` column) that runs automatically on `wiki.setup()`. No call-site changes needed; `WikiConfig` defaults apply to the single `wiki.read()` call in `useAIChat.ts`.

**Tech Stack:** TypeScript, Expo, `@equationalapplications/expo-llm-wiki`, Jest

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `package.json` | `^2.5.0` → `^2.6.0` |
| Modify | `src/services/wikiService.ts` | Add `preFilterLimit: 300`, `hybridWeight: 0.7` to `config` |
| No change | `src/hooks/useAIChat.ts` | `wiki.read()` call unaffected; config defaults apply automatically |
| No change | `package-lock.json` | Updated by `npm install` |

---

## Task 1: Bump the dependency

**Files:**
- Modify: `package.json` (line 35)

- [ ] **Step 1: Edit `package.json`**

Change:
```json
"@equationalapplications/expo-llm-wiki": "^2.5.0",
```
To:
```json
"@equationalapplications/expo-llm-wiki": "^2.6.0",
```

- [ ] **Step 2: Install**

```bash
npm install
```

Expected: installs cleanly, `package-lock.json` updated, no peer-dep errors.

- [ ] **Step 3: Verify CHANGELOG for breaking changes**

```bash
cat node_modules/@equationalapplications/expo-llm-wiki/CHANGELOG.md | head -60
```

Expected: `2.6.0` entry shows only additive changes (`embedding_blob`, `ReadOptions`, `preFilterLimit`, `hybridWeight`). No breaking changes.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): bump expo-llm-wiki to ^2.6.0"
```

---

## Task 2: Add retrieval tuning config

**Files:**
- Modify: `src/services/wikiService.ts` (lines 11–19)

- [ ] **Step 1: Write the test first**

In `__tests__/wikiService.test.ts` (already exists — add this test case inside the `setupWiki` / `createWiki` describe block, or create a new describe if none exists):

```typescript
it('passes preFilterLimit and hybridWeight to createWiki config', () => {
  const mockDb = {} as SQLiteDatabase
  setupWiki(mockDb)
  expect(mockCreateWiki).toHaveBeenCalledWith(
    mockDb,
    expect.objectContaining({
      config: expect.objectContaining({
        preFilterLimit: 300,
        hybridWeight: 0.7,
      }),
    }),
  )
})
```

> **Note:** If `__tests__/wikiService.test.ts` does not mock `createWiki`, check how the file sets up mocks before adding. The existing pattern in `characterSyncWiki.test.ts` mocks `wikiService` at the module level — `wikiService.test.ts` should mock `createWiki` from `@equationalapplications/expo-llm-wiki` directly.

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm test -- --testPathPattern="wikiService" --runInBand
```

Expected: FAIL — assertion `preFilterLimit: 300` not present in call args.

- [ ] **Step 3: Implement — add config fields in `src/services/wikiService.ts`**

Current block (lines 11–19):
```typescript
  _wiki = createWiki(db, {
    llmProvider: createWikiLlmProvider(),
    config: {
      tablePrefix: 'llm_wiki_',
      autoLibrarianThreshold: 20,
    },
  })
```

Replace with:
```typescript
  _wiki = createWiki(db, {
    llmProvider: createWikiLlmProvider(),
    config: {
      tablePrefix: 'llm_wiki_',
      autoLibrarianThreshold: 20,
      preFilterLimit: 300,
      hybridWeight: 0.7,
    },
  })
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npm test -- --testPathPattern="wikiService" --runInBand
```

Expected: PASS.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. The new `WikiConfig` fields (`preFilterLimit: number`, `hybridWeight: number`) are valid in v2.6.0.

- [ ] **Step 6: Lint**

```bash
npm run lint
```

Expected: no new lint errors.

- [ ] **Step 7: Run target test suites**

```bash
npm test -- --testPathPattern="wikiService|characterSyncWiki|aiChatService|chatComposer" --runInBand
```

Expected: all PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/services/wikiService.ts
git commit -m "feat(wiki): add preFilterLimit and hybridWeight to WikiConfig

preFilterLimit: 300 caps cosine scan to top-300 keyword candidates,
preventing O(N) growth for characters with large fact stores.
hybridWeight: 0.7 blends 70% semantic + 30% keyword scoring,
improving recall for queries with precise terminology."
```

---

## Task 3: Full verification

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all suites pass. No regressions in any wiki, chat, or character tests.

- [ ] **Step 2: Typecheck one more time**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Lint one more time**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 4: Manual simulator check (human step)**

Launch on an iOS/Android simulator that has existing app data. After first launch:

1. Open a DB browser (e.g. DB Browser for SQLite) and inspect the `llm_wiki_entries` table.
2. Confirm `embedding_blob BLOB` column is present.
3. Confirm no crash on startup.
4. Send a chat message to a character with existing wiki facts — confirm the response is coherent (wiki context loaded).

---

## Excluded (per spec)

- No `wiki.runReembed()` call — lazy migration only; old TEXT embeddings served until naturally re-embedded.
- No `wiki.clearVectorCache()` call — auto-invalidation on `ingestDocument()` is sufficient.
- No per-call `ReadOptions` overrides in `useAIChat.ts` — `WikiConfig` defaults cover the only call site.
- No UI surface for tuning `hybridWeight` / `preFilterLimit`.
