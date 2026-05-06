# expo-llm-wiki Retrieval Tuning — Part 2: Upgrade (implement after package releases)

> **⚠️ BLOCKED:** `feat/retrieval-tuning` PR in expo-llm-wiki is still in code review. v2.6.0 is
> already published (CI fixes only — no retrieval-tuning features). Confirm actual published version
> before executing Task 1. Version references below use `<TBD>` as a placeholder.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bump `@equationalapplications/expo-llm-wiki` to `^<TBD>` and add `preFilterLimit: 300`
+ `hybridWeight: 0.7` to `WikiConfig` in `wikiService.ts`. The TDD test from Part 1 drives the
implementation — enable it first, make it green.

**Prerequisite:** Part 1 must be complete (skipped test exists in `wikiService.test.ts`).

**Architecture:** Two isolated changes — a dependency version bump and two new optional fields in
an existing config object. The new package ships a lazy SQLite migration (adds `embedding_blob BLOB`
column) that runs automatically on `wiki.setup()`. No call-site changes needed; `WikiConfig`
defaults apply to the single `wiki.read()` call in `useAIChat.ts`.

**Tech Stack:** TypeScript, Expo, `@equationalapplications/expo-llm-wiki`, Jest

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `package.json` | `^2.5.0` → `^<TBD>` (confirm version after PR publishes) |
| Modify | `__tests__/wikiService.test.ts` | Enable `.skip` → `it` (remove `.skip`) |
| Modify | `src/services/wikiService.ts` | Add `preFilterLimit: 300`, `hybridWeight: 0.7` to `config` |
| No change | `src/hooks/useAIChat.ts` | `wiki.read()` call unaffected; config defaults apply automatically |
| No change | `package-lock.json` | Updated by `npm install` |

---

## Task 1: Bump the dependency

**Files:**
- Modify: `package.json`

- [ ] **Step 0: Confirm published version**

```bash
npm view @equationalapplications/expo-llm-wiki versions --json | tail -5
```

Expected: a version newer than `2.6.0` that contains the retrieval-tuning features.
Use that version for steps below (`<TBD>`). If only `2.6.0` is listed, the PR has not
published yet — stop and wait.

- [ ] **Step 1: Edit `package.json`**

Change:
```json
"@equationalapplications/expo-llm-wiki": "^2.5.0",
```
To:
```json
"@equationalapplications/expo-llm-wiki": "^<TBD>",
```

- [ ] **Step 2: Install**

```bash
npm install
```

Expected: installs cleanly, `package-lock.json` updated, no peer-dep errors.

- [ ] **Step 3: Verify CHANGELOG for retrieval-tuning features**

```bash
cat node_modules/@equationalapplications/expo-llm-wiki/CHANGELOG.md | head -80
```

Expected: the new version entry shows retrieval-tuning features (`embedding_blob`, `ReadOptions`,
`preFilterLimit`, `hybridWeight`). Note: `packages/core` was bumped to v3.0.0 internally
(`WikiBusyOperation` union extended with `'import'` and `'forget'`) — no Clanker code changes
needed since all `WikiBusyError` usage is `instanceof`-only, no exhaustive switches on `.operation`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): bump expo-llm-wiki to ^<TBD>"
```

---

## Task 2: Enable test and implement config

**Files:**
- Modify: `__tests__/wikiService.test.ts`
- Modify: `src/services/wikiService.ts`

- [ ] **Step 1: Enable the skipped test**

In `__tests__/wikiService.test.ts`, change:
```typescript
it.skip('passes preFilterLimit and hybridWeight to createWiki config', () => {
```
To:
```typescript
it('passes preFilterLimit and hybridWeight to createWiki config', () => {
```

- [ ] **Step 2: Run test — confirm it fails (red)**

```bash
npm test -- --testPathPattern="wikiService" --runInBand
```

Expected: FAIL — `preFilterLimit: 300` not present in `mockCreateWiki` call args.

- [ ] **Step 3: Implement — add config fields in `src/services/wikiService.ts`**

Current block:
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

- [ ] **Step 4: Run test — confirm it passes (green)**

```bash
npm test -- --testPathPattern="wikiService" --runInBand
```

Expected: 5 PASS, 0 SKIP.

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```

Expected: no errors. The new `WikiConfig` fields (`preFilterLimit`, `hybridWeight`) are valid in
the new package version.

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
git add __tests__/wikiService.test.ts src/services/wikiService.ts
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

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: clean.

- [ ] **Step 3: Lint**

```bash
npm run lint
```

Expected: clean.

- [ ] **Step 4: Manual simulator check (human step)**

Launch on an iOS/Android simulator with existing app data. After first launch:

1. Open a DB browser and inspect the `llm_wiki_entries` table.
2. Confirm `embedding_blob BLOB` column is present.
3. Confirm no crash on startup.
4. Send a chat message to a character with existing wiki facts — confirm the response is coherent
   (wiki context loaded).

---

## Excluded (per spec)

- No `wiki.runReembed()` call — lazy migration only; old TEXT embeddings served until naturally re-embedded.
- No `wiki.clearVectorCache()` call — auto-invalidation on `ingestDocument()` is sufficient.
- No per-call `ReadOptions` overrides in `useAIChat.ts` — `WikiConfig` defaults cover the only call site.
- No UI surface for tuning `hybridWeight` / `preFilterLimit`.
