# Close #375 + drop `characters.avatar` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one combined PR to `staging` that (A) migrates every remaining reader off the legacy `characters.avatar` column and drops it via hand-written migration 0025, and (B) closes issue #375 with production numbers from the `credit_spend_events` ledger.

**Architecture:** Part A removes the retired Phase 1 rollback net top-down — SQL migration first (with a shape-guard test), then the cloud read/write paths in `functions/`, then the app-side wire types and sync code, then the two deliberate UI tail fallbacks. Every mismatch cell in the old-client/new-backend compatibility matrix tolerates its counterpart, so deploy ordering is unconstrained and the change rides OTA. Part B is analysis-only: three SQL queries the user runs against prod, a drafted issue comment, a manual close.

**Tech Stack:** TypeScript (Expo app root workspace), Firebase Functions (`functions/`, node:test — NOT Jest), Drizzle schema mirror with hand-written SQL migrations, PostgreSQL 18 (Cloud SQL), GitHub CLI for the issue/PR mechanics.

**Spec:** `docs/superpowers/specs/2026-08-22-issue-375-close-and-avatar-column-drop-design.md` (the plan argues from the spec — executors read both).

## Global Constraints

These apply to every task implicitly:

- **Never run `npx drizzle-kit generate`.** The drizzle journal (`functions/drizzle/meta/_journal.json`) is stuck at 0011 while on-disk migrations pass 0024; generating would assign a conflicting index. Hand-written next-index SQL is the repo convention.
- **No `BREAKING CHANGE:` git footer anywhere on this branch.** runtimeVersion = package MAJOR, so such a footer would force a store update and prune OTA installs. All changes here are JS/TS + SQL and ride OTA by design.
- **CI gates are `:check`, never `--write`/`--fix`.** Formatting sweeps never share a commit with logic changes.
- **Root-workspace test runs are always scoped**: `npx jest <path>` — a bare `npm test` collects the unrigged 122-file tree and drowns in expected noise. `functions/` uses **node:test**, not Jest (`cd functions && npm test` = build + `node --test`).
- **The PR targets `staging`** (never `main`). `Closes #375` in the PR body will NOT auto-fire (default branch is `main`) — the issue closes manually in Task 9.
- **No backfill of legacy portraits.** Characters whose only portrait was the dropped URL render bundled default/initials afterward. Accepted explicitly by the user (spec Non-goals). Do not "helpfully" add one.
- **Local SQLite columns stay.** No device-side migration: `src/database/*` and `src/machines/characterMachine.ts` are untouched on purpose.
- **Keep the `parseOptionalTextField` helper** — only its avatar call-site and union member go.
- **No casts, no `avatar?: never` placeholder types.** Removing the field from `CharacterSnapshot` turns every surviving read into a compile error; fix the reads, don't silence them.
- Line numbers below were verified 2026-08-22 against HEAD `22e6afdb`. Re-locate by content if they drift.

---

### Task 1: Migration 0025 + migration-shape guard

**Files:**

- Create: `functions/drizzle/0025_drop_characters_avatar.sql`
- Modify: `functions/scripts/migrationOrder.mjs:34` (append to `MIGRATION_ORDER`)
- Modify: `functions/scripts/migrationOrder.test.mjs` (imports + two new tests)
- Modify: `docs/db-migrations.md` ("Production: Applied Migrations" table, after the row for 24 at line 92)

**Interfaces:**

- Consumes: nothing (first task).
- Produces: `MIGRATION_ORDER` whose last entry is `'0025_drop_characters_avatar.sql'`; a SQL file on disk whose entire content is exactly `ALTER TABLE characters DROP COLUMN IF EXISTS avatar;`. Task 2's schema edit mirrors this end state; Task 5 applies it locally.

- [ ] **Step 1: Write the failing shape-guard tests**

Add these imports to the top of `functions/scripts/migrationOrder.test.mjs` (this file uses semicolons — match it):

```js
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
```

Append at the bottom of the file:

```js
const DRIZZLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')

test('the newest tracked migration is the characters.avatar drop', () => {
  assert.equal(MIGRATION_ORDER[MIGRATION_ORDER.length - 1], '0025_drop_characters_avatar.sql')
})

test("0025's SQL drops the avatar column and nothing else", () => {
  // Shape guard: the journal is out of sync, so an accidental `drizzle-kit
  // generate` could swap different SQL in under a registered filename. Pin the
  // exact text — this starts the repo's first SQL-text-shape convention.
  const sql = readFileSync(join(DRIZZLE_DIR, '0025_drop_characters_avatar.sql'), 'utf8').trim()
  assert.equal(sql, 'ALTER TABLE characters DROP COLUMN IF EXISTS avatar;')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd functions && node --test --test-reporter spec scripts/migrationOrder.test.mjs`
Expected: FAIL — one test because the last entry is still `0024_credit_spend_events.sql`, one with `ENOENT` for the missing SQL file.

- [ ] **Step 3: Create the migration file**

`functions/drizzle/0025_drop_characters_avatar.sql` — the file's entire content is exactly this one line plus a trailing newline:

```sql
ALTER TABLE characters DROP COLUMN IF EXISTS avatar;
```

- [ ] **Step 4: Register it**

In `functions/scripts/migrationOrder.mjs`, append one entry to `MIGRATION_ORDER` after `'0024_credit_spend_events.sql',`:

```js
  '0025_drop_characters_avatar.sql',
```

Do NOT touch `_journal.json` or `meta/` snapshots.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd functions && node --test --test-reporter spec scripts/migrationOrder.test.mjs`
Expected: PASS (all tests in the file, including the eight pre-existing ones).

- [ ] **Step 6: Add the changelog row**

In `docs/db-migrations.md`, add to the "Production: Applied Migrations" table directly after the row numbered 24 (line ~92), matching the table's alignment:

```markdown
| 25 | `0025_drop_characters_avatar.sql` | Drop legacy `characters.avatar` rollback-net column (Phase 1 OTA cycle elapsed; readers migrated in the same PR). Rides OTA with the app-side removal |
```

Then confirm formatting: `npx prettier --check docs/db-migrations.md`
Expected: clean (prettier owns this table's alignment — if it reports a diff, run `npx prettier --write docs/db-migrations.md` and include the result; that is still this task's deliverable, not a sweep).

- [ ] **Step 7: Commit**

```bash
git add functions/drizzle/0025_drop_characters_avatar.sql functions/scripts/migrationOrder.mjs functions/scripts/migrationOrder.test.mjs docs/db-migrations.md
git commit -m "chore(db): hand-write migration 0025 dropping characters.avatar"
```

---

### Task 2: Cloud-side reader removal (`functions/`)

**Files:**

- Modify: `functions/src/db/schema.ts:160` (drop the column from the pgTable)
- Modify: `functions/src/services/characterService.ts:9,26` (Pick union + update-values mapping)
- Modify: `functions/src/characterFunctions.ts:16,87,413,452` (payload type, parser union, parse call-site, upsert value)
- Test: `functions/src/services/characterService.test.ts:14,29,45` (fixture keys) + one new test
- Test: `functions/src/characterFunctions.test.ts` (repurpose one test, add one test, strip fixture keys)

**Interfaces:**

- Consumes: Task 1's registered migration (schema mirror must match its end state).
- Produces: cloud API responses with no `avatar` key anywhere (`serializeCharacter` spreads whole rows, so removing the column removes the output field with zero edits to `serializeCharacter` itself); `SyncCharacterPayload` without `avatar` (old clients sending it are silently ignored); `parseOptionalTextField` retained with union `'appearance' | 'traits' | 'emotions' | 'context' | 'voice'`.

**Spec correction discovered during planning:** the spec's table row "`~87`: drop `'avatar'` from the `updateCharacterField` field union" refers to what is actually `parseOptionalTextField`'s `field` parameter union at `characterFunctions.ts:87` — there is no single-field-update callable in the backend, so the "old clients calling with `field: 'avatar'`" concern reduces to old clients sending `character.avatar` inside the `syncCharacter` payload, which this task makes a silently-ignored field. Everything else in the spec holds as written.

- [ ] **Step 1: Update the failing-facing tests first (red)**

In `functions/src/services/characterService.test.ts`, delete the line `avatar: null,` from all three `buildCharacterUpdateValues({...})` inputs (lines 14, 29, 45 — omitting an optional property compiles both before and after the change). Then append this new test at the bottom of the file:

```ts
test('buildCharacterUpdateValues never writes the dropped avatar column', () => {
  const result = buildCharacterUpdateValues({
    name: 'Updated',
    appearance: null,
    traits: null,
    emotions: null,
    context: null,
    voice: 'narrator',
    isPublic: true,
    updatedAt: undefined,
  })

  assert.equal('avatar' in result, false)
})
```

In `functions/src/characterFunctions.test.ts`:

(a) Repurpose the validation test at lines ~142–161 — the backend must now reject a bad `appearance`, not a bad `avatar`. Replace the payload and the message assertion:

```ts
test('syncCharacterHandler rejects invalid optional text fields', async () => {
  await assert.rejects(
    async () =>
      syncCharacterHandler(
        {
          auth,
          data: {
            character: {
              name: 'Nova',
              appearance: 42,
            },
          },
        } as never,
        buildDeps(),
      ),
    (err: unknown) =>
      err instanceof HttpsError &&
      err.code === 'invalid-argument' &&
      err.message.includes('character.appearance must be a string or null'),
  )
})
```

(b) Immediately after it, add the old-client-tolerance test:

```ts
test('syncCharacterHandler silently drops the removed avatar payload field', async () => {
  const captured: unknown[] = []
  const createdAt = new Date('2026-01-01T00:00:00.000Z')
  const updatedAt = new Date('2026-01-02T00:00:00.000Z')
  const result = await syncCharacterHandler(
    {
      auth,
      data: {
        // Pre-drop clients still send `avatar`; the field must be ignored —
        // neither rejected nor stored.
        character: { name: 'Nova', avatar: 'https://example.com/legacy.png' },
      },
    } as never,
    {
      userRepository: {
        findUserByFirebaseUid: async () => ({ id: 'user-1' }) as never,
      },
      characterService: {
        upsertCharacter: async (...args: unknown[]) => {
          captured.push(args[0])
          return {
            id: 'character-1',
            userId: 'user-1',
            name: 'Nova',
            appearance: null,
            traits: null,
            emotions: null,
            context: null,
            isPublic: false,
            createdAt,
            updatedAt,
          } as never
        },
      } as never,
      creditService: {
        spendCredits: async () => [{ transactionId: 'tx-123', amount: 1 }],
        refundCredit: async () => {},
      },
    } as unknown as CharacterFunctionDeps,
  )

  assert.equal((result as Record<string, unknown>).name, 'Nova')
  assert.equal(captured.length, 1)
  assert.equal('avatar' in (captured[0] as Record<string, unknown>), false)
})
```

(c) Strip the now-dead fixture keys from the mock rows — delete `avatar: null,` at lines ~212, ~567, ~682, ~723, ~891 and `avatar: 'https://example.com/avatar.png',` at ~765. These mocks are `as never` so they'd keep passing either way; the point is that the suite stops asserting the removed field exists.

- [ ] **Step 2: Run to verify red**

Run: `cd functions && npm test`
Expected: FAIL — build succeeds (all edited literals still compile), then exactly the two new tests fail: `'avatar' in result` is currently `true`, and the captured upsert input currently contains `avatar`.

- [ ] **Step 3: Implement the removal**

`functions/src/db/schema.ts` — delete line 160 from the `characters` pgTable:

```ts
    avatar: text('avatar'),
```

`functions/src/services/characterService.ts` — delete `| 'avatar'` from the `CharacterUpdateInput` Pick union (line 9) and delete `avatar: character.avatar,` from `updateValues` (line 26):

```ts
type CharacterUpdateInput = Pick<
  typeof characters.$inferInsert,
  | 'name'
  | 'appearance'
  | 'traits'
  | 'emotions'
  | 'context'
  | 'voice'
  | 'isPublic'
  | 'saveToCloud'
  | 'updatedAt'
>
```

```ts
const updateValues = {
  name: character.name,
  appearance: character.appearance,
  traits: character.traits,
  emotions: character.emotions,
  context: character.context,
  ...(normalizedVoice === undefined ? {} : { voice: normalizedVoice }),
  updatedAt: character.updatedAt ?? new Date(),
}
```

`functions/src/characterFunctions.ts` — four deletions:

1. Line 16: `  avatar?: string | null` out of `SyncCharacterPayload`.
2. Line 87: shrink the parser union to `field: 'appearance' | 'traits' | 'emotions' | 'context' | 'voice',` (keep the function itself — it stays for appearance/traits/emotions/context/voice).
3. Line 413: delete `const avatar = parseOptionalTextField(character.avatar, 'avatar')`.
4. Line 452: delete `        avatar,` from the `upsertCharacter` values object (old clients' extra payload field is now simply never parsed, never stored).

Leave `serializeCharacter`, `getPublicCharacterHandler` (its portrait path is `activeImageId` → signed Storage URL and touches no column), and every other callable untouched.

- [ ] **Step 4: Run to verify green**

Run: `cd functions && npm run typecheck && npm test`
Expected: typecheck clean; full functions suite green (~469+ tests — the two new ones included, the repurposed one passing against `appearance`).

- [ ] **Step 5: Commit**

```bash
git add functions/src/db/schema.ts functions/src/services/characterService.ts functions/src/services/characterService.test.ts functions/src/characterFunctions.ts functions/src/characterFunctions.test.ts
git commit -m "refactor(functions): stop reading and writing characters.avatar"
```

---

### Task 3: App-side wire types and sync service

**Files:**

- Modify: `src/services/apiClient.ts:86,135`
- Modify: `src/services/characterSyncService.ts:346,452,499`

**Interfaces:**

- Consumes: nothing from Tasks 1–2 at compile time (independent worktrees of the same removal), but semantically pairs with Task 2's response shape.
- Produces: `CharacterSnapshot` and `SyncCharacterPayload` without `avatar`; the three sync sites rewritten so no reference to the field survives anywhere in `src/` (root typecheck is the completeness net).

- [ ] **Step 1: Remove `avatar` from both wire interfaces**

`src/services/apiClient.ts` — delete line 86 (`  avatar?: string | null`) from `SyncCharacterPayload` and line 135 (`  avatar: string | null`) from `CharacterSnapshot`. Both interfaces otherwise unchanged.

- [ ] **Step 2: Rewrite the three sync sites**

`src/services/characterSyncService.ts`:

(a) **On pull** — `restoreFromCloud` row mapping (line 346). Replace `avatar: cloudChar.avatar,` with the carry-over form (`existingLocal` is already in scope at line 341):

```ts
          name: cloudChar.name,
          // The cloud snapshot stopped carrying the legacy `avatar` URL when
          // the column was dropped (migration 0025). batchInsertCharacters is
          // INSERT OR REPLACE, so carry over whatever the local row has rather
          // than hard-nulling — on un-migrated devices that local value is the
          // last copy of a legacy portrait. A genuinely new device has no local
          // row and gets null: the intended "no gallery portrait yet" state.
          avatar: existingLocal?.avatar ?? null,
```

(The existing comment block above `avatar_data:` stays as-is — it documents those two fields specifically.)

(b) **On push** — `syncUnsyncedToCloud` upload payload (line 452). Delete the single line `          avatar: char.avatar,`. This erases nothing locally; it only stops writing toward the server.

(c) **Shared import** — `importSharedCharacterFromCloud` insert (line 499). Replace `avatar: cloudCharacter.avatar,` with the carry-over form (`existingLocal` is in scope from line 491), folding the old standalone comment into one:

```ts
      name: cloudCharacter.name,
      // Same reasoning as restoreFromCloud: the snapshot no longer carries the
      // dropped legacy column, and INSERT OR REPLACE means preserve whatever a
      // previous import of this character already had locally.
      avatar: existingLocal?.avatar ?? null,
      avatar_data: existingLocal?.avatar_data ?? null,
      avatar_mime_type: existingLocal?.avatar_mime_type ?? null,
```

(Delete the now-redundant comment that previously sat alone above `avatar_data:`.)

Never hard-null legacy copies: both pull-shaped sites read `existingLocal?.avatar ?? null`, never a bare `null` literal.

- [ ] **Step 3: Typecheck — the completeness net**

Run: `npm run typecheck`
Expected: clean. If any `cloud*.avatar` read survived anywhere in `src/`, this fails — fix the read the same way (carry-over on pull-shaped sites, deletion on push-shaped sites). Do not add casts.

- [ ] **Step 4: Scoped sanity test**

Run: `npx jest src/components/__tests__/ChatView.test.tsx`
Expected: PASS — its `baseCharacter` fixture is the _local_ `Character` type (which keeps `avatar`), so this file is untouched; the run proves no collateral damage.

- [ ] **Step 5: Commit**

```bash
git add src/services/apiClient.ts src/services/characterSyncService.ts
git commit -m "refactor(app): drop avatar from cloud character wire types and sync"
```

---

### Task 4: Remove the deliberate UI tail fallbacks

**Files:**

- Modify: `app/(drawer)/(tabs)/talk/index.tsx:86–94`
- Modify: `src/components/ChatView.tsx:182–188`

**Interfaces:**

- Consumes: `useResolvedImage(imageId, variant)` → `{ uri: string | null; isResolved: boolean }` (`src/hooks/useResolvedImage.ts`).
- Produces: `headerAvatar`/`bodyAvatar`/`characterAvatar` keep their exact names and their exact `string | null` types — downstream JSX needs zero edits. `CharacterAvatar` continues supplying the bundled default when null.

- [ ] **Step 1: talk screen**

Replace lines 86–94 of `app/(drawer)/(tabs)/talk/index.tsx` — delete the deprecated-column comment along with the fallbacks, binding the hook URIs directly to the existing variable names:

Before:

```tsx
// Phase 1 pipeline first, then the deprecated `characters.avatar` column as a
// tail fallback for devices whose one-shot migration has not run and for
// characters that predate `avatar_data`. `CharacterAvatar` supplies the
// bundled default when both are null. Two variants because the body avatar is
// the screen's focal element and the header is 40px.
const { uri: resolvedHeaderAvatar } = useResolvedImage(character?.active_image_id, 'thumb')
const headerAvatar = resolvedHeaderAvatar ?? character?.avatar ?? null
const { uri: resolvedBodyAvatar } = useResolvedImage(character?.active_image_id, 'master')
const bodyAvatar = resolvedBodyAvatar ?? character?.avatar ?? null
```

After:

```tsx
// Two variants because the body avatar is the screen's focal element and the
// header is 40px. `CharacterAvatar` supplies the bundled default when null.
const { uri: headerAvatar } = useResolvedImage(character?.active_image_id, 'thumb')
const { uri: bodyAvatar } = useResolvedImage(character?.active_image_id, 'master')
```

- [ ] **Step 2: chat header**

Replace lines 182–188 of `src/components/ChatView.tsx`:

Before:

```tsx
// Phase 1 pipeline first, then the deprecated `characters.avatar` column as a
// tail fallback for devices whose one-shot migration has not run and for
// characters that predate `avatar_data` entirely — those legitimately have a
// working legacy URL and no gallery row. `CharacterAvatar` supplies the
// bundled default when both are null.
const { uri: resolvedAvatar } = useResolvedImage(character.active_image_id, 'thumb')
const characterAvatar = resolvedAvatar ?? character.avatar ?? null
```

After:

```tsx
// `CharacterAvatar` supplies the bundled default when null.
const { uri: characterAvatar } = useResolvedImage(character.active_image_id, 'thumb')
```

- [ ] **Step 3: Typecheck and scoped test**

Run: `npm run typecheck && npx jest src/components/__tests__/ChatView.test.tsx`
Expected: typecheck clean, test PASS. (If typecheck flags another `character.avatar` read elsewhere, it means a reader was missed in planning — migrate it the same way rather than reverting.)

- [ ] **Step 4: Commit**

```bash
git add "app/(drawer)/(tabs)/talk/index.tsx" src/components/ChatView.tsx
git commit -m "refactor(app): remove legacy characters.avatar tail fallbacks"
```

---

### Task 5: Apply 0025 to the local docker Postgres

**Files:** none changed — this is verification only.

**Interfaces:**

- Consumes: Task 1's migration + registration; the dev runner tracks applied files in a `dev_migrations` table and refuses non-listed files.

- [ ] **Step 1: Bring Postgres up (skip if already running)**

```bash
docker compose -f docker-compose.local.yml up -d postgres_db
```

If the container fails to start on an old data directory, recreate per `docs/db-migrations.md`: `docker compose -f docker-compose.local.yml rm -sfv postgres_db && docker compose -f docker-compose.local.yml up -d postgres_db`.

- [ ] **Step 2: Apply migrations through 0025**

Run: `cd functions && npm run migrate:dev`
Expected: applies `0025_drop_characters_avatar.sql` (plus anything else pending) and reports success.

- [ ] **Step 3: Confirm the column is gone**

```bash
docker compose -f docker-compose.local.yml exec postgres_db psql -U clanker_dev -d clanker -tAc \
  "SELECT column_name FROM information_schema.columns WHERE table_name='characters' AND column_name='avatar'"
```

Expected: **empty output** (no rows).

- [ ] **Step 4: Confirm idempotency**

Run again: `cd functions && npm run migrate:dev`
Expected: `Skipping … already applied` for 0025; no SQL executed.

---

### Task 6: Manual smoke (web or emulator)

Requires a running app — if the executing agent cannot drive one, hand this checklist to the user and record the results in the PR description instead of marking it done silently.

- [ ] **Step 1: Gallery-backed portrait still renders.** Open a character that has a `character_images` gallery row: portrait renders on the talk screen header + body and in the chat header, via `useResolvedImage`.
- [ ] **Step 2: Portrait-less character degrades gracefully.** A character with no gallery row renders the bundled default / initials in all three places (no crash, no blank box).
- [ ] **Step 3: Cloud sync round-trips.** Edit a save-to-cloud character, force a sync, then pull/restore — completes without error; the local row keeps whatever portrait state it had.
- [ ] **Step 4: Shared-character import still lands a portrait.** Import a shared character whose owner has a gallery-backed active image — the importer stores the downloaded portrait via `saveCharacterImage`. (This path consumes `getPublicCharacter`'s `avatarSignedUrl`, not the dropped column — verified during design. Only imports of legacy-cohort characters lose portraits, the accepted loss.)

No commit — nothing changes.

---

### Task 7: Issue #375 — verify premise and prepare the analysis

**Files:**

- Create (scratch, outside repo): `/tmp/issue-375-comment.md`

**Interfaces:**

- Consumes: prod `credit_spend_events` (live since 2026-08-22, migration 0024) and `subscriptions.plan_tier`.
- Produces: the drafted comment Task 9 posts, and the three queries handed to the user.

- [ ] **Step 1: Re-verify the premise against current code**

Run: `grep -n "wiki_llm\|spendCredits\|WIKI_CREDIT_COST" functions/src/wikiLlm.ts`
Expected: `spendCredits(user.id, WIKI_CREDIT_COST, 'wiki_llm')` executes **before** the model call, with a `null` allocation throwing `failed-precondition` ('Insufficient credits'). Also confirm `refundCredit` writes no `credit_spend_events` row (ledger records gross attempted spends only). If this no longer holds, STOP — the comment's core claim is wrong and needs rework, not just fresh numbers.

- [ ] **Step 2: Hand the three queries to the user**

The user runs prod SQL themselves and pastes results back (their stated preference — do not connect to prod or screenshot consoles). Coverage-window caveat to include in the eventual comment: the ledger only has rows since 2026-08-22, so absolute volumes are ~1 day old; the structural cap does not depend on volume.

Query 1 — sanity sweep, ledger by reason:

```sql
SELECT reason,
       COUNT(*)                AS events,
       COUNT(DISTINCT user_id) AS users,
       SUM(amount)             AS total_credits
FROM credit_spend_events
GROUP BY reason
ORDER BY total_credits DESC;
```

Query 2 — librarian spend split by plan tier:

```sql
SELECT s.plan_tier,
       e.reason,
       COUNT(*)                  AS events,
       COUNT(DISTINCT e.user_id) AS users,
       SUM(e.amount)             AS gross_credits,
       ROUND(SUM(e.amount)::numeric / NULLIF(COUNT(DISTINCT e.user_id), 0), 1)
                                 AS avg_gross_per_user
FROM credit_spend_events e
JOIN subscriptions s ON s.user_id = e.user_id
WHERE e.reason IN ('wiki_llm', 'wiki_sync')
GROUP BY s.plan_tier, e.reason
ORDER BY s.plan_tier, gross_credits DESC;
```

Query 3 — per-user distribution:

```sql
SELECT s.plan_tier,
       percentile_cont(0.5)  WITHIN GROUP (ORDER BY u.gross) AS median_per_user,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY u.gross) AS p95_per_user,
       MAX(u.gross)          AS max_single_user
FROM (
  SELECT e.user_id, SUM(e.amount) AS gross
  FROM credit_spend_events e
  WHERE e.reason IN ('wiki_llm', 'wiki_sync')
  GROUP BY e.user_id
) u
JOIN subscriptions s ON s.user_id = u.user_id
GROUP BY s.plan_tier;
```

- [ ] **Step 3: Draft the comment with result slots**

Write `/tmp/issue-375-comment.md` using this template (fill `<PASTE: …>` slots once the user replies; Task 9 posts it):

```markdown
## Premise correction: librarian cost is structurally capped

This issue assumed librarian LLM calls are an open-ended free-tier cost. They are not:

- `wikiLlm` spends credits **before** every model call (`functions/src/wikiLlm.ts` —
  `spendCredits(user.id, WIKI_CREDIT_COST, 'wiki_llm')`) and hard-fails with
  `failed-precondition` ("Insufficient credits") when the allocation comes back empty. A
  free-tier user can never spend past their balance, so lifetime librarian exposure is
  capped by spendable credits — at most the **5,000-credit signup grant**.
- The real product risk was therefore trial cannibalization (librarian burning the
  conversion runway), not COGS.

One visibility limit worth naming: the ledger records **gross attempted spends**. When a
wiki call fails, credits are refunded — but refunds touch only `credit_transactions`,
not `credit_spend_events`, so the ledger cannot separate refunded attempts out. Gross ≠
net for failed calls; quantifying the failure/refund share is out of scope here.

Coverage window: `credit_spend_events` went live 2026-08-22 (attribution shipped in
#623/#624), so absolute volumes below are ~1 day old — the structural cap above does not
depend on volume.

## Production numbers

<details><summary>Ledger by reason</summary>

<paste query 1 output>

</details>

<details><summary>Librarian spend by plan tier</summary>

<paste query 2 output>

</details>

<details><summary>Per-user distribution</summary>

<paste query 3 output>

</details>

## Decision

Cost acceptable, no change — exposure is structurally capped per user; ongoing
monitoring continues via the `credit_spend_events` ledger. Queries preserved above for
re-runs.

Closing manually (`Closes:` does not fire from a `staging`-targeted PR). Companion PR:
#<PR_NUMBER>.
```

---

### Task 8: Full gate sweep, push, open the PR

**Files:**

- None created; pushes the branch and opens the PR (base `staging`).

**Interfaces:**

- Consumes: Tasks 1–6 complete and committed.
- Produces: the PR URL that Task 9's closing comment links.

- [ ] **Step 1: Re-run every gate at final head**

After ANY late commit, gates go stale — re-run them all at the final head, never trust earlier greens (recorded lesson from PR #624's format drift):

```bash
cd functions && npm run typecheck && npm test && cd ..
npm run typecheck
git diff --name-only origin/staging | grep -E '\.(ts|tsx|md|mjs)$' | xargs npx prettier --check
```

Expected: functions typecheck + full suite green; root typecheck clean; prettier clean on every touched tracked file. cloud-agent is untouched by this PR — no cloud-agent gates needed.

- [ ] **Step 2: Audit commit hygiene**

Run: `git log --oneline origin/staging..HEAD`
Expected: four commits (Tasks 1–4), each logic-or-doc coherent, no formatting sweep mixed with a logic change, and no `BREAKING CHANGE:` footer on any of them (`git log --format='%B' origin/staging..HEAD | grep -i BREAKING` → empty).

- [ ] **Step 3: Push and open the PR**

```bash
git push -u origin chore/issue-375-and-avatar-column-drop
gh pr create --base staging --title "Drop characters.avatar (rollback net expired)" --body-file /tmp/pr-body.md
```

with `/tmp/pr-body.md` containing (fill the smoke-test results from Task 6):

```markdown
## Summary

Removes the legacy `characters.avatar` column — the Phase 1 rollback net whose
one-release-cycle fence elapsed after releases #609/#618/#622/#625 — and closes #375
with production numbers posted on the issue (analysis only; this PR carries no code for
that item).

- Migration `0025_drop_characters_avatar.sql` (hand-written, registered in
  `migrationOrder.mjs`, shape-guarded by a new test) — single
  `DROP COLUMN IF EXISTS avatar`.
- Cloud readers/writers migrated off the column (`schema.ts`,
  `characterService.ts`, `characterFunctions.ts`); `serializeCharacter` stops emitting
  `avatar` implicitly; `getPublicCharacter` keeps resolving portraits via
  `active_image_id` → signed Storage URL, unchanged.
- App wire types (`CharacterSnapshot`, `SyncCharacterPayload`) lose `avatar`;
  `restoreFromCloud` / `importSharedCharacterFromCloud` carry over the local row's
  value instead of hard-nulling; the upload payload stops sending it.
- The two deliberate tail fallbacks (`talk/index.tsx`, `ChatView.tsx`) are removed —
  they stop being load-bearing exactly now.

Explicitly accepted: legacy-cohort characters whose only portrait was the dropped URL
render bundled default/initials after this ships. No backfill (user decision,
2026-08-22). Local SQLite columns stay and go inert — no device migration.

## Compatibility matrix (deploy ordering unconstrained)

| App ↓ · Backend →   | Old backend (column live)                                                                     | New backend (column dropped)                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Pre-Phase-1 app     | today's behavior                                                                              | upload field ignored; responses lack `avatar` → bundled default (accepted loss, no crash surface) |
| New app (post-drop) | works; backend stores/returns `avatar: null`, client ignores it (transient OTA↔deploy window) | target state                                                                                      |

## Rollback posture

Once 0025 has applied, reverting code restores the field, not the data. Legacy portraits
are unrecoverable after the drop; gallery-backed portraits unaffected. Support runbook
for "lost portrait" tickets: no technical recovery — offer re-generating via
AvatarPicker.

Deploy shape: JS/TS + SQL only → rides OTA; no `BREAKING CHANGE:` footers on this
branch. No deployed staging env exists, so this reaches prod via the normal
staging→main promotion flow.

## Smoke tested

<results from Task 6>
```

---

### Task 9: Post the #375 comment and close the issue manually

**Files:** none; GitHub state changes only.

**Interfaces:**

- Consumes: Task 7's filled-in comment (user-pasted results) and Task 8's PR number.
- Produces: issue #375 closed with a documented decision.

- [ ] **Step 1: Sanity-check the pasted numbers against the premise**

Expected shape: free-tier `wiki_llm`/`wiki_sync` totals bounded well under 5000 gross credits/user lifetime; paid tiers may spend more. **If the numbers contradict the structural-cap premise in some unexpected way, STOP and flag to the user for discussion before closing** — the spec requires a documented decision, and an anomalous result deserves one made deliberately, not forced.

- [ ] **Step 2: Post the comment**

```bash
gh issue comment 375 --body-file /tmp/issue-375-comment.md
```

- [ ] **Step 3: Close manually**

```bash
gh issue close 375 --reason completed
gh issue view 375 --json state,title
```

Expected: `state: CLOSED`. (`Closes #375` was deliberately absent from the PR body — it cannot auto-fire against a non-default base branch.)

---

## After merge (user-driven; outside executor scope)

Recorded here so the sequence survives session boundaries — none of this is an executor task:

1. Apply to prod: `cd functions && MIGRATIONS=0025_drop_characters_avatar.sql npm run deploy:migrations` (automatic on-demand Cloud SQL backup first; idempotency re-run should print "Skipping … already applied"). Ordering vs deploys/OTA is unconstrained per the compatibility matrix, but applying the migration first matches established practice.
2. Promote and deploy the functions backend; confirm all updated functions report success.
3. Publish the OTA update — verify no commit on the promoted range carries a `BREAKING CHANGE:` footer.
4. Support runbook (from the spec): "my character lost its portrait" tickets on legacy characters have **no technical recovery path** — respond with that fact and offer re-generation via AvatarPicker.
