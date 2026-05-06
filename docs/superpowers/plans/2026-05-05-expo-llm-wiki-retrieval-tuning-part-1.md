# expo-llm-wiki Retrieval Tuning — Part 1: TDD Test (implement now)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write the skipped TDD test that specifies `preFilterLimit: 300` + `hybridWeight: 0.7` in
the `WikiConfig`. Test stays `.skip` until the package ships and Part 2 is executed. CI stays green.

**Why now:** Documents the implementation contract in code before the package is available.
Gives Part 2 a ready-to-enable test — no test authoring needed when the package ships.

**Follows:** `2026-05-05-expo-llm-wiki-retrieval-tuning-part-2.md` (execute after package releases)

**Tech Stack:** TypeScript, Jest

---

## File Map

| Action | File | Change |
|--------|------|--------|
| Modify | `__tests__/wikiService.test.ts` | Add one `.skip` test inside the `wikiService` describe block |

---

## Task 1: Add the skipped test

**Files:**
- Modify: `__tests__/wikiService.test.ts`

- [ ] **Step 1: Add `.skip` test inside the `wikiService` describe block**

In `__tests__/wikiService.test.ts`, inside the `describe('wikiService', ...)` block after the
existing `initWiki` test:

```typescript
it.skip('passes preFilterLimit and hybridWeight to createWiki config', () => {
  const db = {} as any
  setupWiki(db)
  expect(mockCreateWiki).toHaveBeenCalledWith(
    db,
    expect.objectContaining({
      config: expect.objectContaining({
        preFilterLimit: 300,
        hybridWeight: 0.7,
      }),
    }),
  )
})
```

> **Note:** `createWiki` is already mocked at the top of the file as `mockCreateWiki`.
> No new mock setup needed. The `.skip` keeps CI green until Part 2 enables it.

- [ ] **Step 2: Verify CI stays green**

```bash
npm test -- --testPathPattern="wikiService" --runInBand
```

Expected: 4 PASS, 1 SKIP (the new test). No failures.

- [ ] **Step 3: Commit**

```bash
git add __tests__/wikiService.test.ts
git commit -m "test(wiki): add skipped test for preFilterLimit + hybridWeight config

Specifies the expected WikiConfig contract for the expo-llm-wiki retrieval-tuning
upgrade. Kept as .skip until the package publishes and Part 2 is executed."
```
