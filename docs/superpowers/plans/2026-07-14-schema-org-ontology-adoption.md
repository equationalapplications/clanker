# Schema.org Ontology Adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every cloud-linked character gets the curated schema.org ontology (`schemaOrgWarmAgentManifest`, strict mode) seeded automatically during sync, unlocking typed fact extraction and backfill.

**Architecture:** Bump the wiki packages to 4.22.0 (triple-keyed edge validation), add the published manifest package, and add one seeding block in `syncWikiForCloud`'s backfill loop: if a character has no ontology manifest after sync completes, write `schemaOrgWarmAgentManifest` with mode `strict` via `wiki.setOntologyManifest`. The existing sync machinery propagates it to cloud Postgres (`llm_wiki_ontology`) on the next sync; the existing `runOntologyBackfill` call types old facts against it.

**Tech Stack:** React Native / Expo, npm (package-lock.json), Jest (`npm test`), TypeScript (`npm run typecheck`), `@equationalapplications/expo-llm-wiki` + `@equationalapplications/schema-org-llm-wiki` 4.22.0.

**Spec:** `docs/superpowers/specs/2026-07-14-curated-schema-ontology-design.md`

**Branch:** `feat/schema`. PRs in this repo target `staging`, not `main` (see `docs/GIT_WORKFLOW.md`).

---

## Task 1: Bump wiki dependencies and add the manifest package

All three packages released at 4.22.0 (release run completed 2026-07-14; verified on npm). The published `expo-llm-wiki@4.22.0` pins `core-llm-wiki@4.22.0` exact, so all must move together.

**Files:**
- Modify: `package.json:42-43` (dependency versions)
- Modify: `package-lock.json` (via `npm install`, never by hand)

- [ ] **Step 1: Update dependency versions**

In `package.json`, change the two existing lines and add the new package (dependencies are alphabetized; `schema-org-llm-wiki` sorts after `expo-llm-wiki`):

```json
    "@equationalapplications/core-llm-wiki": "^4.22.0",
    "@equationalapplications/expo-llm-wiki": "^4.22.0",
    "@equationalapplications/schema-org-llm-wiki": "^4.22.0",
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: exits 0, `package-lock.json` updated.

- [ ] **Step 3: Verify the manifest package resolves and has the expected shape**

Run:
```bash
node -e "const { schemaOrgWarmAgentManifest: m } = require('@equationalapplications/schema-org-llm-wiki'); console.log(m.node_types.length, m.edge_types.length)"
```
Expected output: `9 28`

- [ ] **Step 4: Verify nothing broke**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: exits 0 (required validation after changing repository-root files — see `AGENTS.md`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: bump wiki packages to 4.22.0, add schema-org-llm-wiki manifest package"
```

---

## Task 2: Seed the ontology manifest during sync (TDD)

**Files:**
- Modify: `src/services/characterSyncService.ts` (imports at line 33-36; backfill loop at lines 179-199)
- Test: `__tests__/characterSyncWiki.test.ts`

**Where the seed goes:** `syncWikiForCloud` already loops over `cloudChars` after a successful `wikiOrchestrator.syncAll`, calling `wiki.runOntologyBackfill(char.id)` per character. The seed check goes at the top of that loop body: read `wiki.getOntologyManifest(char.id)` (returns `null` when no manifest exists — resolution order is DB row → config seed → `null`); if `null`, call `wiki.setOntologyManifest(char.id, schemaOrgWarmAgentManifest, { mode: 'strict' })`. Placing it *after* `syncAll` matters: if the cloud had a manifest, `runRemoteSync` already wrote it locally via the `cloudBundle.ontology` branch, so the null-check correctly defers to cloud state. Seed failures must not block backfill (mode stays `off`, backfill is a no-op, next sync retries).

- [ ] **Step 1: Give the mock wiki default ontology methods**

The production change calls `getOntologyManifest`/`setOntologyManifest` in the backfill loop, so every existing test that reaches that loop needs these methods on the mock wiki. In `__tests__/characterSyncWiki.test.ts`, add two module-level mocks next to `mockRunOntologyBackfill` (line 8):

```ts
const mockGetOntologyManifest = jest.fn()
const mockSetOntologyManifest = jest.fn()
```

Extend `makeMockWiki` (lines 14-19) so explicit `overrides` still win:

```ts
function makeMockWiki(overrides: Record<string, unknown> = {}) {
  return {
    runOntologyBackfill: (...args: unknown[]) => mockRunOntologyBackfill(...args),
    getOntologyManifest: (...args: unknown[]) => mockGetOntologyManifest(...args),
    setOntologyManifest: (...args: unknown[]) => mockSetOntologyManifest(...args),
    ...overrides,
  }
}
```

Add defaults inside **each** of the three `beforeEach` blocks (lines 110-115, 357-362, 509-513), after `jest.clearAllMocks()`:

```ts
    mockGetOntologyManifest.mockResolvedValue(null)
    mockSetOntologyManifest.mockResolvedValue(undefined)
```

Note: the existing test `propagates ontology through runRemoteSync in both directions` (line 242) builds its own inline mocks via `makeMockWiki({ getOntologyManifest: ..., setOntologyManifest: ... })` — the spread override keeps it working unchanged.

- [ ] **Step 2: Run existing tests to confirm the mock change is non-breaking**

Run: `npm test __tests__/characterSyncWiki.test.ts`
Expected: all existing tests PASS.

- [ ] **Step 3: Write the failing tests**

Add a new `describe` block at the end of `__tests__/characterSyncWiki.test.ts` (after the `restoreFromCloud wiki sync reporting` block). Also add the manifest import at the top of the file, with the other imports (line 75):

```ts
import { schemaOrgWarmAgentManifest } from '@equationalapplications/schema-org-llm-wiki'
```

```ts
describe('ontology manifest seeding', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetWiki.mockReturnValue(makeMockWiki())
    mockRunOntologyBackfill.mockResolvedValue(makeBackfillResult())
    mockSyncAll.mockResolvedValue(undefined)
    mockGetOntologyManifest.mockResolvedValue(null)
    mockSetOntologyManifest.mockResolvedValue(undefined)
  })

  it('seeds the schema.org manifest in strict mode when a character has none', async () => {
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])

    await syncAllToCloud('user-1')

    expect(mockSetOntologyManifest).toHaveBeenCalledTimes(1)
    expect(mockSetOntologyManifest).toHaveBeenCalledWith(
      LOCAL_ID,
      schemaOrgWarmAgentManifest,
      { mode: 'strict' },
    )
    // Seed must land before backfill so the batch types facts against the manifest.
    expect(mockSetOntologyManifest.mock.invocationCallOrder[0]).toBeLessThan(
      mockRunOntologyBackfill.mock.invocationCallOrder[0],
    )
    expect(reportError).not.toHaveBeenCalled()
  })

  it('skips seeding when a manifest already exists', async () => {
    mockGetOntologyManifest.mockResolvedValue({
      mode: 'strict',
      manifest: { node_types: [{ type: 'person', description: 'A person' }], edge_types: [] },
    })
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])

    await syncAllToCloud('user-1')

    expect(mockSetOntologyManifest).not.toHaveBeenCalled()
    expect(mockRunOntologyBackfill).toHaveBeenCalledWith(LOCAL_ID)
  })

  it('reports seed failures with the seed tag and still runs backfill', async () => {
    mockSetOntologyManifest.mockRejectedValue(new Error('disk full'))
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([makeCloudChar()])

    await expect(syncAllToCloud('user-1')).resolves.toBeUndefined()

    expect(reportError).toHaveBeenCalledTimes(1)
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      `wiki:${LOCAL_ID}:ontology:seed`,
    )
    expect(mockRunOntologyBackfill).toHaveBeenCalledWith(LOCAL_ID)
  })

  it('seeds each cloud character independently', async () => {
    const secondLocalId = 'char-local-2'
    const secondCloudId = '550e8400-e29b-41d4-a716-446655440001'
    // First character already has a manifest; second doesn't.
    mockGetOntologyManifest
      .mockResolvedValueOnce({
        mode: 'strict',
        manifest: { node_types: [{ type: 'person', description: 'A person' }], edge_types: [] },
      })
      .mockResolvedValueOnce(null)
    mockGetAllCharactersIncludingDeleted.mockResolvedValue([
      makeCloudChar(),
      makeCloudChar({ id: secondLocalId, cloud_id: secondCloudId }),
    ])

    await syncAllToCloud('user-1')

    expect(mockSetOntologyManifest).toHaveBeenCalledTimes(1)
    expect(mockSetOntologyManifest).toHaveBeenCalledWith(
      secondLocalId,
      schemaOrgWarmAgentManifest,
      { mode: 'strict' },
    )
  })
})
```

- [ ] **Step 4: Run the new tests to verify they fail**

Run: `npm test __tests__/characterSyncWiki.test.ts -t "ontology manifest seeding"`
Expected: 4 FAIL — `mockSetOntologyManifest` never called (seed logic doesn't exist yet). The skip-seeding test may pass trivially; that's fine.

- [ ] **Step 5: Implement the seed block**

In `src/services/characterSyncService.ts`, add the import after the existing `@equationalapplications/expo-llm-wiki` imports (line 34):

```ts
import { schemaOrgWarmAgentManifest } from '@equationalapplications/schema-org-llm-wiki'
```

Then extend the backfill loop. Current code (lines 179-199):

```ts
    // Best-effort: type facts that bypassed the librarian (cloud-agent writes,
    // pre-ontology facts). One batch per sync; backlog converges across syncs.
    for (const char of cloudChars) {
        try {
            const result = await wiki.runOntologyBackfill(char.id)
```

New code — insert the seed block at the top of the loop body, before the backfill `try`:

```ts
    // Best-effort: type facts that bypassed the librarian (cloud-agent writes,
    // pre-ontology facts). One batch per sync; backlog converges across syncs.
    for (const char of cloudChars) {
        // Seed the curated schema.org ontology for characters that have none.
        // Runs after syncAll so a manifest restored from cloud wins over the seed;
        // the seeded manifest propagates to cloud on the next sync. On failure the
        // character stays in mode 'off' and the next sync retries.
        try {
            const existing = await wiki.getOntologyManifest(char.id)
            if (!existing) {
                await wiki.setOntologyManifest(char.id, schemaOrgWarmAgentManifest, { mode: 'strict' })
            }
        } catch (err) {
            reportWikiOpForCharacter(err, `wiki:${char.id}:ontology:seed`, char.id, 'Failed to seed ontology manifest')
        }

        try {
            const result = await wiki.runOntologyBackfill(char.id)
```

Everything from `const result = await wiki.runOntologyBackfill(char.id)` down (the stalled check and the backfill catch) stays exactly as is.

- [ ] **Step 6: Run the new tests to verify they pass**

Run: `npm test __tests__/characterSyncWiki.test.ts -t "ontology manifest seeding"`
Expected: 4 PASS.

- [ ] **Step 7: Run the whole test file**

Run: `npm test __tests__/characterSyncWiki.test.ts`
Expected: all PASS (existing backfill/sync tests unaffected thanks to the Step 1 mock defaults).

- [ ] **Step 8: Commit**

```bash
git add src/services/characterSyncService.ts __tests__/characterSyncWiki.test.ts
git commit -m "feat: seed schema.org ontology manifest for cloud characters during sync"
```

---

## Task 3: Full verification and spec status update

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-curated-schema-ontology-design.md:4` (status line)

- [ ] **Step 1: Full verification**

Run: `npm run typecheck && npm run lint && npm run test`
Expected: exits 0 (required validation after changing repository-root files — see `AGENTS.md`). If unrelated suites were already failing before this branch, note them but don't fix here.

- [ ] **Step 2: Mark the spec implemented**

In `docs/superpowers/specs/2026-07-14-curated-schema-ontology-design.md`, change line 4:

```markdown
**Status:** Implemented (seeding shipped in feat/schema)
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/2026-07-14-curated-schema-ontology-design.md
git commit -m "docs: mark curated schema ontology spec as implemented"
```

---

## Task 4: Integration sanity check + PR

- [ ] **Step 1: Manual smoke test (dev client)**

With the local dev stack running (fresh docker Postgres needs `migrate:dev` + `seedLocal.ts` first — see `docs/` local dev notes), launch the app, open a cloud-linked character, send a message that states a typed fact (e.g. "My friend Maria works for Acme Corp"), then trigger a sync. Verify in dev logs:
- `[ontology:backfill] char-…` logs a result with `scanned > 0` on a character with pre-existing untyped facts, or all-zero counters on a fresh one — either proves the manifest is active (mode `off` short-circuits before scanning).
- No `wiki:…:ontology:seed` error reports.

If a full local stack isn't available, an acceptable fallback is asserting the seeded state directly: after one sync, `wiki.getOntologyManifest(charId)` in a dev console returns mode `strict` with 9 node types.

- [ ] **Step 2: Push and open PR against `staging`**

```bash
git push -u origin feat/schema
gh pr create --base staging --title "feat: adopt curated schema.org ontology (schema-org-llm-wiki 4.22.0)" --body "$(cat <<'EOF'
## Summary
- Bump expo-llm-wiki/core-llm-wiki to 4.22.0 (triple-keyed edge validation) and add @equationalapplications/schema-org-llm-wiki 4.22.0
- Seed schemaOrgWarmAgentManifest (9 nodes / 28 edges, strict mode) for every cloud-linked character that has no manifest, during the post-sync backfill loop
- Manifest propagates to cloud Postgres on the next sync; existing runOntologyBackfill types old facts against it

Spec: docs/superpowers/specs/2026-07-14-curated-schema-ontology-design.md

## Test plan
- [ ] New Jest tests: seeding, skip-when-present, fail-soft reporting, per-character independence
- [ ] Existing characterSyncWiki suite green
- [ ] npm run typecheck / lint:check green

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** dep bumps (Task 1), edge-side seeding before backfill (Task 2), backfill reuse (existing code, asserted in tests), cloud propagation (existing sync path, no changes needed per spec), prompt/librarian/cloud-agent (no changes per spec). Unit tests for seeding match the spec's testing strategy; LLM-classification and graph-query checks are the Task 4 smoke test — full sampled-facts evaluation is post-merge observation, not CI.
- **Types verified against installed 4.22.0 source:** `getOntologyManifest → Promise<{mode, manifest} | null>`, `setOntologyManifest(entityId, manifest, { mode? })`, `schemaOrgWarmAgentManifest: OntologyManifest`.
- **Mock-wiki gap** (existing tests lacking ontology methods) handled explicitly in Task 2 Step 1 before any production change.
