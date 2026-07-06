# Spec: OKF Profile v1 Adoption — First-Class OKF Support

**Date:** 2026-07-05
**Status:** Approved
**Related:** `expo-llm-wiki/docs/okf-profile.md` (normative profile v1), `expo-llm-wiki/docs/superpowers/specs/2026-07-05-okf-profile-design.md` (design record), `expo-llm-wiki/docs/superpowers/specs/2026-07-05-okf-summary-persistence-design.md` (upstream prerequisite), `2026-07-03-okf-export-design.md`, `2026-07-04-okf-import-support-design.md` (both Implemented — this spec supersedes parts of each, called out inline)

## Problem

The llm-wiki OKF profile v1 promoted three of Clanker's per-app workarounds into the format itself, and `@equationalapplications/{expo,core}-llm-wiki` 4.18.x implemented them (verified against package source, 2026-07-05):

- `formatOkfBundle` now natively emits the `## Related` edge section, `profile: llm-wiki/1` root key, event `<!-- id: evt_x -->` comments, and entity summary prose.
- `parseOkfBundle` now enforces the §1 path allow-list, throws on multi-entity bundles, detects the profile key, strips `## Related` into edges (for profile-0 bundles it additionally falls back to body-link scanning), parses summary prose, and **preserves event ids from id comments** (`eventId ?? generateId('evt_')`).

Clanker is pinned to 4.17.3 and still runs the pre-profile workarounds. Three of them are now redundant, and one — the clone-path id remap — is **broken by the upgrade**, not just redundant:

1. **`augmentWithEdgeLinks` (export):** redundant. The package emits `## Related` itself; keeping the call-site pass would double-append the section.
2. **`dedupeEventsAgainstExisting` (restore):** nonconformant as sole strategy. Profile §7: when an event line carries an id, the consumer MUST use it as the event's identity. Blind tuple dedup on a profile-1 bundle can drop genuinely distinct events that share `(event_type, summary, UTC-day)`.
3. **`remapOkfDumpIds` (clone) — the upgrade-blocking bug:** the import spec's premise "events need no id-remap because `parseOkfBundle` regenerates every event id" is false as of 4.18.x for profile-1 bundles. Parsed events keep their original `evt_*` ids. Cloning a bundle while the source character still exists on-device now hits `EventRepository.addIgnoreDuplicate` (`INSERT OR IGNORE` on the `id` primary key) for every event → **the clone silently loses its entire timeline**. This is the same failure class the fact/task remap was built to prevent, arrived late for events.
4. **Entity summary (new consumer MUST):** Clanker emits none (conformant) but must preserve an imported summary across import → export. Handled upstream by the summary-persistence spec (4.19.0) — Clanker inherits conformance by upgrading; no character-table column needed. (Supersedes an earlier in-session decision to add an `okf_summary` column on `characters` — upstream persistence in the wiki meta table is strictly better: no migration, and summaries ride the existing wiki cloud-sync dump path for free.)

"First-class" additionally means the import UX surfaces what the format now knows: profile version and summary at preview time.

## Dependencies and Sequencing

- **Blocked on** expo-llm-wiki 4.19.0 (summary persistence spec). Everything except summary round-trip works against 4.18.1, but the spec targets one bump, not two.
- Bump **both** direct deps together: `@equationalapplications/expo-llm-wiki` and `@equationalapplications/core-llm-wiki` 4.17.3 → `^4.19.0`. (The direct `core-llm-wiki` dep exists for `formatGraphContext` in `src/services/edgeToolExecutors.ts` — unrelated to OKF, but the versions must not skew.)
- Still **no direct `core-okf` dependency** (export-spec decision holds): everything Clanker needs is reachable through `expo-llm-wiki` re-exports, and the one new piece of parsing Clanker does itself (the event-id scan below) is a single regex taken verbatim from profile §7, not a `core-okf` call.
- Old exported bundles in the wild are profile 0 forever — every fallback path in this spec is permanent, not transitional.

## Changes

### 1. Export: delete edge augmentation (supersedes export-spec "Edge Augmentation")

- Delete `src/utils/augmentWithEdgeLinks.ts` and `src/utils/__tests__/augmentWithEdgeLinks.test.ts`.
- `useExportCharacterOKF`: drop the augment step; pipeline becomes `exportDump` → `formatOkfBundle` → add README → zip → save.
- The package now emits profile key, `## Related`, event id comments, and (when present) summary — Clanker's export is fully profile-1 conformant with zero export-side code beyond the pipeline glue that already exists.
- The bundle `README.md` (added at zip time, tolerated at bundle root by profile §1) stays.

### 2. Restore: id-first event dedup with per-event tuple fallback (amends import-spec "events duplicate on every restore")

`parseOkfBundle` output can't distinguish a preserved id from a freshly generated one. Rather than branch on the root `profile` key (coarse — a formatter can strip comments from a profile-1 log, and profile §7 says id handling is per-line), Clanker scans the log itself:

- In `src/utilities/okfImport.ts` (or `okfImportDedupe.ts`), scan the cached bundle's `log.md` content with the profile §7 regex applied per line — `/<!--\s*id:\s*(\S+)\s*-->\s*$/` — collecting a `Set<string>` of explicit event ids.
- `dedupeEventsAgainstExisting` gains that set as an argument and filters per event:
  - id ∈ explicit-id set → **pass through untouched**. Identity is the id; `EventRepository.addIgnoreDuplicate` makes re-import a no-op at the DB layer. No tuple check — two distinct profile-1 events may legitimately share a tuple.
  - id ∉ set (regenerated — legacy bundle or stripped comment) → existing tuple dedup `(event_type, summary, UTC-day)` against the target entity's current events.
- Handles profile-0 (no ids → all tuple), profile-1 (all ids → dedup entirely at DB layer), and mixed/mangled bundles correctly per event. The tuple logic is **never deleted** — profile-0 bundles exist forever.

### 3. Clone: remap event ids (fixes the upgrade-blocking bug; amends import-spec "ID Remapping" step 4)

`remapOkfDumpIds` additionally regenerates every event's `id` via the same `randomUUID()` used for facts/tasks. `related_entry_id` remapping is unchanged. Rationale inline in code comment: as of profile v1, event ids survive parsing, so a clone alongside a still-live source character would otherwise collide on the events table's id primary key and be silently dropped by `INSERT OR IGNORE`.

(Event ids are not referenced by anything else in the dump — no edge or fact points at an event — so regeneration needs no map, just fresh ids.)

### 4. Summary: inherited from upstream; surfaced read-only

- Round-trip conformance is automatic after the 4.19.0 bump: `parseOkfBundle` → `importDump` persists (wiki meta table) → `exportDump` → `formatOkfBundle` re-emits.
- Clanker writes no summaries (stays a non-producer; conformant per profile §4).
- UX (see §6): summary shown at import preview and on the character's memory/settings surface when present.

### 5. Keep intact (now normative, per profile §8)

- Zip safeguards in `okfImport.ts`: entry-count cap, declared-size pre-filter + running-total decompression cap.
- Clanker's own path allow-list and multi-entity pre-check, **kept as the user-facing gate** even though `parseOkfBundle` now enforces both: Clanker's checks run before decompressed content is handed anywhere and produce the friendly copy ("This bundle contains multiple characters…"); the package's throw becomes defense-in-depth. Import error handling must still catch the package's multi-entity `Error` in case the pre-check and package disagree.
- `remapOkfDumpIds` fact/task/edge behavior, cross-entity collision guard semantics, `WikiBusyError` handling, `OkfPickCancelledError` flow — all unchanged.

### 6. First-class UX

- **Richer import preview:** the preview dialog adds, above the existing counts line:
  - Profile badge — "OKF profile: llm-wiki/1" vs "Legacy bundle (pre-profile)". Detection: root `index.md` frontmatter contains `profile: llm-wiki/1` (regex on the cached file content; display-only, no behavior branches on it — dedup branches per-event, §2).
  - Summary snippet — first ~200 chars of `dump.entities[previewId].summary` when present, with "Memory summary included" label.
- **Summary display:** character edit screen (`app/(drawer)/(tabs)/characters/[id]/edit.tsx`) gains a read-only "Memory summary" section, rendered only when the wiki has a summary for the character — read via `wiki.getEntitySummary(characterId)` (new in 4.19.0, added by the summary-persistence spec precisely so display doesn't require a full blob-carrying `exportDump`). Placed near the existing import/export buttons.
- **Public docs refresh:**
  - `public/memory-export-with-okf/index.html`: mention bundles now carry the versioned `llm-wiki/1` profile, stable event identity (no more duplicate timeline entries on repeated restores), and that summaries from other OKF tools (e.g. Curated Thoughts) survive round-trips.
  - `app/support.tsx` FAQ pair: one-line addition on restore idempotency.
  - `src/constants/okfReadmeContent.ts` (bundle README): note the profile identifier and link the profile doc.
  - No privacy-policy change — data categories exported are unchanged.

## Error Handling (delta only)

- Package multi-entity throw and any `parseOkfBundle` error surface through the existing "This doesn't look like a valid OKF backup" path.
- Everything else unchanged from the import spec.

## Testing

- **Round-trip conformance:** feed `golden-v1` fixture content (checked-in vendored copy under `src/utilities/__tests__/fixtures/`, with a checksum assertion against the values recorded in the package repo — the fixtures are not part of the published npm tarball, and the profile doc's fixture-drift guidance applies to any vendored copy) through the full import pipeline into a real `WikiMemory`, export, and assert edges, event ids, and summary survive per the profile's fidelity table.
- **Legacy fallback:** `legacy-profile-0` fixture exercises tuple dedup, no-summary, body-link edge extraction paths.
- **Dedup:** mixed log (some lines with id comments, some without) — id-carrying events pass through even when tuple-identical to existing events; id-less events tuple-dedup as before; importing the same profile-1 bundle twice yields no duplicate event rows (DB-level assertion).
- **Clone regression (the headline test):** export character A (profile-1), clone to character B while A still exists in the same DB → B's event count equals A's. This fails against unfixed `remapOkfDumpIds` on 4.18.x+.
- **Export:** exported bundle contains exactly one `## Related` section per edge-bearing concept (regression against double-append), the profile key, and event id comments — asserted via `parseOkfBundle` round-trip, not string matching alone.
- **Preview UX:** profile badge shows "legacy" for profile-0 fixture, "llm-wiki/1" for golden fixture; summary snippet renders when present.
- Existing suites updated: `augmentWithEdgeLinks` tests deleted with their subject; `okfImportDedupe`/`okfImportRemap`/hook tests amended per §§2–3.
- CI: `npm run typecheck && npm run lint && npm run test`.

## Non-Goals

- Summary authoring/editing in Clanker (deliberate deferral; requires a producer-side API upstream and librarian interplay — separate spec when wanted).
- Ontology manifest serialization (profile 2).
- Multi-entity import, cross-entity edges (profile limitations).
- Replace-mode event clearing (application policy; unchanged).
- Upstream skip-count reporting for collision-guard hits (unchanged from import spec).

## References

- `expo-llm-wiki/packages/core/src/utils/parseOkfBundle.ts`, `formatOkfBundle.ts` @ 4.18.1 (read directly 2026-07-05 — basis for every "the package now does X" claim above)
- `expo-llm-wiki/packages/core/src/services/ImportExportService.ts` — `doImportEntity`/`getFullBundle` (summary gap, `addIgnoreDuplicate` semantics)
- `expo-llm-wiki/packages/core/src/repositories/MetadataRepository.ts` — `{prefix}meta` kv (upstream summary storage)
- `packages/okf/fixtures/{golden-v1,legacy-profile-0}/` — conformance fixtures
- `src/hooks/useExportCharacterOKF.ts`, `src/hooks/useImportCharacterOKF.ts`, `src/utilities/{okfImport,okfImportDedupe,okfImportRemap}.ts`, `src/utils/augmentWithEdgeLinks.ts` — Clanker touch points
