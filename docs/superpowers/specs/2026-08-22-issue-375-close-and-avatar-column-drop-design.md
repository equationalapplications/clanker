# Close #375 + drop `characters.avatar` — design

- **Date:** 2026-08-22
- **Status:** Implemented (2026-08-23) on `chore/issue-375-and-avatar-column-drop` — code tasks 1–4 complete and task-reviewed; manual smoke (Task 6) handed to user; issue #375 comment + close pending production numbers
- **Branch / PR:** `chore/issue-375-and-avatar-column-drop`, one PR targeting `staging`
- **Related specs:** [avatar render pipeline divergence](2026-08-10-avatar-render-pipeline-divergence-design.md), [avatar bubble unification](2026-08-10-avatar-bubble-unification-design.md), [streaming-id unification & credit-spend attribution](2026-08-21-streaming-id-unification-and-credit-spend-attribution-design.md)

## Context

Two follow-ups ship together as one PR:

1. **Issue #375** ("Validate free-tier librarian cost with autoLibrarianThreshold: 5") was blocked
   on spend attribution. Attribution now exists: `credit_spend_events` went live in prod on
   2026-08-22 (migration 0024, both backends deployed the same evening), and every spend is tagged
   with a reason token from the registry. The issue is now answerable with SQL — analysis plus a
   comment/close, no code.
2. **`characters.avatar`** is the Phase 1 rollback net from the avatar pipeline refactor
   (PR #589). Phase 2 shipped and releases #609/#618/#622/#625 have all gone out since, so the
   one-release-cycle fence has elapsed. The column's remaining readers are migrated off it and the
   column is dropped.

## Goals

- Answer #375 with production numbers and a documented decision; close the issue.
- Remove `characters.avatar` from the cloud schema and every read/write path that still touches it.
- Keep the change OTA-safe for existing clients.

## Non-goals

- **No backfill of the legacy cohort.** Characters whose only portrait is a legacy `characters.avatar`
  URL (created before `character_images` existed, never re-edited) lose that portrait permanently.
  Accepted explicitly (user decision, 2026-08-22): those characters render the bundled default /
  initials after this ships. `character_images.storage_path` is Firebase-Storage-paths-only, so a
  URL-preserving backfill has no clean home — rejected rather than half-done.
- **No local SQLite schema change.** The device-side `characters.avatar` / `avatar_data` /
  `avatar_mime_type` columns stay, going inert. Avoiding an on-device migration removes the only
  real risk surface this change would otherwise have.
- **Not in this PR:** the purchase integration test suite idea (separate parked thread).

---

## Part A — drop `characters.avatar`

### Migration 0025

Hand-write `functions/drizzle/0025_drop_characters_avatar.sql`:

```sql
ALTER TABLE characters DROP COLUMN IF EXISTS avatar;
```

Register it in `functions/scripts/migrationOrder.mjs`. Never run `drizzle-kit generate` (the drizzle
journal is out of sync; hand-written next-index SQL is the repo convention). No data backfill, no
new indexes.

### Cloud-side code (functions/)

| File | Change |
| --- | --- |
| `src/db/schema.ts` (~160) | Remove `avatar: text('avatar')` from the `characters` pgTable. |
| `src/services/characterService.ts` (~9, ~26) | Remove `'avatar'` from the select field list and from the row→object mapping. |
| `src/characterFunctions.ts` (~16) | Remove `avatar` from `SyncCharacterPayload`; `syncCharacter` stops parsing (`parseOptionalTextField(character.avatar, ...)`) and storing it — old clients' extra payload field is simply ignored. |
| `src/characterFunctions.ts` (~87) | Drop `'avatar'` from the `updateCharacterField` field union. Old clients calling with `field: 'avatar'` get a validation error — acceptable; no current app code calls it. |
| `serializeCharacter` | Stops emitting `avatar` in API responses. `getPublicCharacter` already resolves portraits via `active_image_id` → signed Storage URL and keeps doing so unchanged. |

`parseOptionalTextField` itself **stays** — it is shared by appearance/traits/emotions/context. Only
the avatar argument/call-site goes; do not delete the helper.

Line numbers are from 2026-08-22 — verify against current code at implementation time. Typecheck is
the net that catches any reference missed here.

### App-side code (src/, app/)

- **Remove the two deliberate tail fallbacks** (they stop being load-bearing only now):
  - `app/(drawer)/(tabs)/talk/index.tsx` (~92–94): `headerAvatar` / `bodyAvatar` become just the
    `useResolvedImage` results.
  - `src/components/ChatView.tsx` (~189): `characterAvatar` becomes just the resolved image.
  - Delete their "deprecated `characters.avatar` column" comments along with the fallbacks.
- **Types:** remove `avatar` from `CharacterSnapshot` and `SyncCharacterPayload` in
  `src/services/apiClient.ts` (~86, ~135).
- **`src/services/characterSyncService.ts`** — three sites, two shapes:
  - **On push** (`syncUnsyncedToCloud`, upload payload ~447–452): drop `avatar` from the payload
    entirely. This erases nothing locally — it only stops writing toward the server.
  - **On pull** (`restoreFromCloud` row mapping ~346; `importSharedCharacterFromCloud` insert
    ~499): these build local rows via INSERT OR REPLACE from a cloud snapshot, where `existingLocal`
    is genuinely the un-migrated-device preservation case. Replace the `cloud*.avatar` read with the
    carry-over `existingLocal?.avatar ?? null` (in scope at both sites). A brand-new local row gets
    `null` — the intended "no gallery portrait yet" state, not a regression. Never hard-null legacy
    copies on un-migrated devices.
  - Removing `avatar` from `CharacterSnapshot` turns every remaining `cloud*.avatar` read into a
    compile error — which is the point: after this rewrite no reference to the field survives, so
    **no casts and no `avatar?: never` placeholder type are needed** anywhere.
- **Untouched on purpose:** `src/database/*` (local column goes inert),
  `src/machines/characterMachine.ts` (optimistic `event.data.avatar ?? null` stays valid against the
  unchanged local type), and everything avatar-*named* but not this column — `src/types/chat.ts`
  (user photo), `aiChatService`/`useAIChat` (`appearance`-based), `userService.avatarUrl`,
  `users.avatar_url`.

### Compatibility matrix

| App version ↓ · Backend state → | Old backend (column live) | New backend (column dropped) |
| --- | --- | --- |
| **Pre-Phase-1 app** (reads/writes `avatar`) | today's behavior | upload field ignored; responses lack `avatar` → UI falls through to bundled default. Pre-Phase-1 clients lose legacy portraits — this is the accepted cost of the drop, not a crash surface (`avatar` is optional/nullable everywhere). |
| **New app** (post-drop, no `avatar` code) | works; backend stores/returns `avatar: null`, new client ignores it. Transient window only: between OTA publish and the backend deploy. | target state |

Because every cell tolerates its mismatch, **deploy ordering is unconstrained**: the backend deploy
(which applies migration 0025 via `scripts/migrate.mjs`) and the app OTA cannot race badly. The
pairing that persists indefinitely is pre-Phase-1 app × new backend — devices that never take the
OTA — and that row's cost is exactly the accepted portrait loss above.

### Rollback posture

Stating it plainly because it is the point of the exercise: once 0025 has applied, reverting the
code restores the *field*, not the *data*. Legacy portraits are unrecoverable after the column
drops; gallery-backed portraits are unaffected. This replaces — deliberately — the rollback net the
column used to provide.

**Support runbook:** after this ships, "my character lost its portrait" tickets on legacy
characters have no technical recovery path. Respond with that fact and offer re-generating an image
via AvatarPicker (which writes through the gallery pipeline).

Deploy shape: JS/TS + SQL only → rides OTA, **no `BREAKING CHANGE:` footer** (runtimeVersion =
package MAJOR; a footer would force a store update and prune OTA installs on both platforms). For a
pure DROP there are no new column semantics an old client would ever need to learn, so the OTA
coverage preserved by omitting the footer is the right trade. There is no deployed staging
environment; the
PR targets the `staging` branch per repo convention and reaches prod via the normal promotion flow,
with the post-deploy traffic check on the new revision.

---

## Part B — close issue #375

### Premise correction (verified in code)

The issue assumes librarian LLM calls are an open-ended free-tier cost. They are not:
`functions/src/wikiLlm.ts` (:137) calls `spendCredits(user.id, WIKI_CREDIT_COST, 'wiki_llm')`
**before** the model call, and a `null` allocation throws `failed-precondition` ('Insufficient
credits'). A free user therefore can never spend past their balance: lifetime librarian exposure is
capped by their spendable credits — at most the 5,000-credit signup grant. The real product risk was
trial cannibalization, not COGS. (Failed model calls refund the spend, but refunds do **not** write
negative rows into `credit_spend_events` — `refundCredit` touches only `credit_transactions` — so
ledger totals below are gross attempted spends.) This premise does not depend on refund
bookkeeping at all — the ledger structurally records spend attempts only; PR #626's SAVEPOINT fix
(cache-sync isolation inside `refundCredit`) is orthogonal here. One visibility limit to name in
the comment: gross ≠ net when a wiki call fails and is refunded, and the ledger cannot separate
those refunds out — quantifying the failure/refund share is out of scope for this analysis.

### Analysis SQL (run against prod Cloud SQL; results pasted back)

Coverage window note for the comment: the ledger only has rows since 2026-08-22, so absolute volumes
are ~1 day old; the structural cap above does not depend on volume.

Sanity sweep — ledger by reason:

```sql
SELECT reason,
       COUNT(*)                AS events,
       COUNT(DISTINCT user_id) AS users,
       SUM(amount)             AS total_credits
FROM credit_spend_events
GROUP BY reason
ORDER BY total_credits DESC;
```

Librarian spend split by plan tier (`subscriptions.plan_tier`: 'free' vs paid tiers):

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

Per-user distribution:

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

### Mechanics

1. Draft the comment on #375: premise correction + the three query results + decision.
2. Expected decision: **"cost acceptable, no change"** — structurally capped, monitoring continues
   via the ledger. If the pasted numbers contradict the premise in some unexpected way, flag it and
   discuss before closing rather than forcing the expected verdict; either way the issue requires a
   documented decision, which the comment provides.
3. Post the comment, then **close #375 manually** — `Closes #375` in the PR description will not
   auto-fire because PRs here merge to `staging`, not the repository's default branch. Link the PR
   from the closing comment.
4. The PR itself carries no code for this item — the issue comment is the deliverable.

---

## Testing & verification

- **Migration:** run the local docker Postgres through `scripts/migrate-dev.mjs`; confirm 0025
  applies cleanly and `information_schema.columns` no longer lists `characters.avatar`.
- **Migration-shape guard:** extend `functions/scripts/migrationOrder.test.mjs` (node:test; already
  in the functions `npm test` glob via `scripts/**/*.test.mjs`) with two assertions: `MIGRATION_ORDER`'s
  last entry is `0025_drop_characters_avatar.sql`, and the file's SQL is exactly
  `ALTER TABLE characters DROP COLUMN IF EXISTS avatar;`. There is no existing SQL-text-shape test
  convention to mirror (the cited-by-review `creditSpendEventsMigration.test.ts` does not exist) —
  this starts one and blocks an accidental `drizzle-kit generate` from swapping in different SQL.
- **Typecheck** in every touched workspace — primary completeness check for reader removal.
- **Unit tests:** update fixtures/tests referencing the removed field; run scoped only
  (`npx jest <path>` at root — a bare run collects the unrigged tree).
- **Manual smoke (web or emulator):** a character with a gallery row still renders its portrait via
  `useResolvedImage`; a character without one renders bundled default / initials on the talk screen
  header+body and the chat header; cloud sync round-trips without error; **shared-character import
  still lands a portrait** — verified during design: that path consumes `getPublicCharacter`'s
  `avatarSignedUrl` (active_image_id → signed Storage URL, with a signed-URL-expiry retry) and
  re-stores it under the importer's account via `saveCharacterImage`; it does not lean on the
  dropped column. Only imports of legacy-cohort characters lose portraits — same accepted loss.

## Commit hygiene

Avatar-drop changes are logic changes and land as such — no formatting sweeps mixed into the same
commits. CI must stay `:check`, never `--write`/`--fix`.
