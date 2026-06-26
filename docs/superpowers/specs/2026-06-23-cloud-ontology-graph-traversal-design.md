# Cloud Ontology & Graph Traversal (Phase 1) — Design Spec

> **⚠️ PARTIALLY SUPERSEDED.** Cloud schema/sync/agent tools in this spec remain accurate. The claim that `generateReply` "must not gain" a tool loop is outdated — phase 2 added stateless per-round `functionCalls` support; the loop stays client-side. See **[Edge Agent](../../edge-agent.md)**.

Date: 2026-06-23
Status: Implemented

## Goal

Bump `@equationalapplications/expo-llm-wiki` and `@equationalapplications/core-llm-tools` to 4.17.0 across the repo, and give the **cloud-agent** (ADK service) the ability to read an entity's ontology manifest and traverse its knowledge graph — mirroring the read-side graph capabilities already shipping in the wiki package's client (SQLite) implementation.

This is phase 1 of the broader Clanker ontology/graph integration. It covers the cloud backend only: package bumps, Postgres schema, edge-sync plumbing, and cloud-agent tools. It explicitly does **not** cover edge-side tool execution, the ontology UI, or the `ChatView` status-hook cleanup — see "Out of scope."

### Why phase 1 is cloud-only

The edge app (Expo/React Native) already owns its own local agent loop: it holds memory in local SQLite via `WikiMemory`, will execute tool calls (including the new graph tools) locally, and calls the `generateReply` Cloud Function purely as a stateless LLM inference backend (bring-your-own-inference — the edge supplies the full `contents` history per turn; `generateReply` has no tool-loop and must not gain one). Building the edge side of this (a new `edgeToolExecutors.ts`-equivalent wiring local `wiki.getOntologyManifest()`/`wiki.traverseGraph()` calls into the existing edge loop) is real work, but it requires no new cloud infrastructure — it's a self-contained phase 2.

The cloud side is different: `cloud-agent` has no graph/ontology storage or tools at all today, and `functions/src/wikiSync.ts` silently drops the `edges` field when syncing local memory to Postgres. Phase 1 builds that missing cloud foundation.

## Current state (verified against installed/published packages and repo code)

- Root `package.json`: `expo-llm-wiki` 4.11.0, `core-llm-tools` ^4.13.1. `functions/package.json` and `cloud-agent/package.json`: `core-llm-tools` ^4.13.1 only (neither depends on `expo-llm-wiki`, which is RN-only).
- `@equationalapplications/expo-llm-wiki`/`core-llm-wiki`@4.17.0 re-export `OntologyManifest`, `OntologyMode`, `traverseGraph`, `formatGraphContext`, `useOntologyManifest`, `useSetOntologyManifest`, `useEntityStatus` — all real, verified against the published tarball.
- `@equationalapplications/core-llm-tools`@4.17.0 exports `wikiGetOntologyManifest`/`wikiTraverseGraphManifest` as `AgentToolManifest` (plain JSON-schema `AgentToolSchema`, not zod).
- `OntologyService.resolveMode()` defaults to `'off'` when no stored mode and no `WikiConfig.ontology.mode` is configured. No character in this app currently configures `ontology`, so after the version bump, edges will **not** start generating until phase 2 ships the manifest-editing UI. This phase builds the pipe; it stays dry until then.
- `cloud-agent/src/tools/wiki.ts` has `wiki_read`/`wiki_write` only (ADK `FunctionTool`, zod params, raw Drizzle queries — no shared `WikiMemory`/`SQLiteAdapter` usage). No librarian/heal/extraction job exists in `cloud-agent` at all — it never derives facts or edges itself, only stores what's handed to it.
- `functions/src/db/schema.ts` has `llmWikiEntries`/`llmWikiTasks`/`llmWikiEvents` but no edges or ontology tables.
- `functions/src/wikiSync.ts` validates/persists/reads back `facts`/`tasks`/`events` only. `MemoryBundle` (the wiki package's sync payload type) already has an optional `edges?: WikiEdge[]` field that this file ignores.
- `src/hooks/useCharacterWiki.ts`'s `sync()` builds `cloudDump`/`remappedDump` by explicitly destructuring `facts`/`tasks`/`events`, dropping `edges` in both directions.
- `WikiEdge` (package type): `{ id, entity_id, source_id, target_id, edge_type, created_at }` — no `deleted_at`. Edges are immutable once created; `EdgeRepository.bulkDeleteByEntityId` hard-deletes, there is no soft-delete concept for edges.
- `GraphTraversalOptions.minTraversalConfidence` "does not gate the anchor" (per package doc comment) — it filters only newly-discovered neighbor nodes, not the traversal's starting node.

## Package version bumps

- Root `package.json`: `@equationalapplications/expo-llm-wiki` → 4.17.0, `@equationalapplications/core-llm-tools` → ^4.17.0.
- `functions/package.json`: `@equationalapplications/core-llm-tools` → ^4.17.0.
- `cloud-agent/package.json`: `@equationalapplications/core-llm-tools` → ^4.17.0, plus **new** dependency `@equationalapplications/core-llm-wiki` ^4.17.0 (for `formatGraphContext` and its `GraphNeighborhood`/`WikiEdge`/`WikiFact` types only — see "cloud-agent tools" below). Note: `core-llm-wiki` itself depends on `minisearch` and `@equationalapplications/core-okf` — both pure JS, no native/SQLite bindings, safe for the Cloud Run container.

## Postgres schema (new migration)

Two new tables in `functions/src/db/schema.ts`, following the existing `llm_wiki_*` conventions:

```ts
export const llmWikiEdges = pgTable('llm_wiki_edges', {
  id: text('id').notNull(),
  entityId: uuid('entity_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceId: text('source_id').notNull(),
  targetId: text('target_id').notNull(),
  edgeType: text('edge_type').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.id, table.userId] }),
  entityUserIdx: index('llm_wiki_edges_entity_user_idx').on(table.entityId, table.userId),
  sourceIdx: index('llm_wiki_edges_source_idx').on(table.sourceId, table.userId),
  targetIdx: index('llm_wiki_edges_target_idx').on(table.targetId, table.userId),
}));

export const llmWikiOntology = pgTable('llm_wiki_ontology', {
  entityId: uuid('entity_id').notNull().references(() => characters.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  mode: text('mode').notNull().default('off'),
  manifest: jsonb('manifest'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.entityId, table.userId] }),
  modeCheck: check('llm_wiki_ontology_mode_check', sql`${table.mode} IN ('strict', 'emergent', 'off')`),
}));
```

Decisions:
- **No `deletedAt` on `llmWikiEdges`.** `WikiEdge` has no soft-delete concept upstream (`EdgeRepository.bulkDeleteByEntityId` hard-deletes); adding a column that's never populated would be dead weight.
- **`sourceIdx`/`targetIdx` on edges.** The traversal CTE walks both directions per hop (`direction: 'inbound' | 'outbound' | 'both'`); both columns need an index to avoid full scans regardless of which direction is requested.
- **`llmWikiOntology` row is optional.** No row for an entity means mode `'off'`, no manifest — this is the expected state for every entity until phase 2's UI writes the first real row. `updatedAt` exists for the future UI's optimistic-concurrency needs, unused by phase 1.

### Migration file

`_journal.json` stops at `0011_credits_redesign`; hand-written migrations `0012`–`0015` already exist on disk (latest: `0015_organizations.sql`). Per the established workflow (`docs/superpowers/specs/2026-06-20-organization-schema-design.md`, `docs/architecture-and-data.md`), `npx drizzle-kit generate` would assign a conflicting number until the journal is re-synced — **do not run it**. Hand-write `functions/drizzle/0016_llm_wiki_graph.sql` (next sequential on-disk index) with `CREATE TABLE`, `ALTER TABLE ... ADD CONSTRAINT` for FKs, and explicit `CREATE INDEX` statements, matching the style of `0015_organizations.sql`. Do not touch `_journal.json` or add snapshot files.

## `wikiSync.ts` — edge persistence

Mirrors the existing `facts`/`tasks`/`events` handling in `functions/src/wikiSync.ts`:

- New local `interface WikiEdge { id, entity_id, source_id, target_id, edge_type, created_at }`, matching the file's existing hand-rolled-type convention (`WikiFact`/`WikiTask`/`WikiEvent` are local interfaces too — no package-type import here, consistent with the rest of the file).
- `MemoryBundle` interface gains optional `edges?: WikiEdge[]`.
- Validation: array-type check + per-edge field validation, same shape as `validateFact`/`validateTask`/`validateEvent`.
- Persistence: upsert into `llmWikiEdges` on `(id, userId)` conflict with `onConflictDoNothing` — edges are immutable once created (no `updated_at` to compare for LWW), so unlike facts/tasks there's no "last write wins" merge, just dedupe-on-id.
- Read-back: select all edges for `(entityId, userId)` into the `remoteDump` bundle — no `deleted_at` filter (edges don't have one).
- Edge **deletion** is not propagated by this sync path in phase 1 (see "Out of scope" — `bulkDeleteByEntityId` is an entity-wide local operation, not a per-edge tombstone in the sync payload).

`src/hooks/useCharacterWiki.ts`'s `sync()` currently builds `cloudDump`/`remappedDump` by explicitly destructuring `facts`/`tasks`/`events`, dropping `edges` in both directions (local→cloud and cloud→local remap). Add `edges: localBundle.edges?.map(e => ({ ...e, entity_id: cloudEntityId })) ?? []` to the local→cloud direction, and the equivalent remap back. Without this, locally-generated edges never reach Postgres regardless of the new table/wikiSync changes.

## cloud-agent tools

New `cloud-agent/src/tools/ontology.ts`, alongside the existing `wiki.ts`/`time.ts` pattern (ADK `FunctionTool`, zod params, raw Drizzle queries):

- **`wiki_get_ontology_manifest`** — no params. Selects the `llmWikiOntology` row for `(entityId, userId)`; returns `{ mode: 'off', manifest: null }` if no row exists.
- **`wiki_traverse_graph`** — params mirror `GraphTraversalOptions`: `sourceId` (required), `maxDepth` (1–3, default 1), `direction` (`'inbound' | 'outbound' | 'both'`, default `'both'`), `edgeTypes` (optional string array filter), `maxTraversalNodes` (default 20), `minTraversalConfidence` (`'certain' | 'inferred' | 'tentative'`, default `'tentative'`). Calls a new `traverseGraphCte` helper, then formats the result with `formatGraphContext` before returning to the agent.

Both tools' `name`/`description`/`parameters` are **re-declared in zod**, not imported from `wikiGetOntologyManifest`/`wikiTraverseGraphManifest` (those are `core-llm-tools`'s plain-JSON-schema `AgentToolSchema`; ADK's `FunctionTool.parameters` needs zod or a `genai.Schema`). This matches the existing zod-throughout style of `wiki.ts`/`time.ts`. Accepted tradeoff: minor wording-drift risk against the upstream manifest's description text, in exchange for type-safe `execute()` arguments and stylistic consistency with the rest of `cloud-agent/src/tools/`.

`formatGraphContext` **is** imported from `@equationalapplications/core-llm-wiki` (new dep, see above) rather than hand-rolled — it's a pure function over `GraphNeighborhood`, no `SQLiteAdapter` required, and reusing it avoids duplicating real formatting logic (not just type shapes).

### `traverseGraphCte`

One recursive CTE (in `cloud-agent/src/tools/wiki.ts` or a new `graph.ts` helper):

- **Anchor row**: validates the `sourceId` exists and belongs to `(entityId, userId)` in `llmWikiEntries` — does **not** apply `minTraversalConfidence` to the anchor (matches the package's own documented semantics: confidence gating "does not gate the anchor," only discovered neighbors).
- **Recursive step**: joins `llmWikiEdges` on whichever column(s) `direction` allows (`source_id` for outbound, `target_id` for inbound, both via `UNION` for `'both'`), filters `edge_type IN (...)` when `edgeTypes` is provided, joins `llmWikiEntries` to apply `minTraversalConfidence` to newly-discovered nodes, stops at `maxDepth`.
- **Cycle guard**: carry a Postgres `text[]` path column (`path || next_id`), recursive step's `WHERE` excludes `next_id = ANY(path)`. This is the direct Postgres-array equivalent of the SQLite implementation's comma-delimited `visited` string + `instr(...) = 0` check in `EdgeRepository.getNeighborhood` (verified in the published package's compiled source) — same cycle-prevention guarantee, idiomatic to Postgres instead of string matching.
- **Ordering and cap**: final `SELECT` does `GROUP BY node_id` (dedupe across multiple paths to the same node, keep `MIN(depth)`), `ORDER BY depth ASC, updated_at DESC LIMIT maxTraversalNodes` — exact match for the SQLite implementation's ordering (BFS-first, recency as tie-breaker among equal-depth nodes).

Both tools registered in `cloud-agent/src/agent.ts`'s tool list, scoped the same way as `wikiReadTool`/`wikiWriteTool`.

## Out of scope

- Edge-side tool execution (`edgeToolExecutors.ts` equivalent) — phase 2.
- Ontology UI on the Character Edit screen (`useOntologyManifest`/`useSetOntologyManifest`, taxonomy editor) — phase 2.
- `ChatView` status-hook cleanup (`useEntityStatus`) — unrelated to this phase; only 2 of the banner's 7 conditions map to `EntityStatus`, the rest are document-upload/escalation state. Separate tiny spec/PR.
- Any tool-execution loop in `functions/src/generateReply.ts` — it is, and must remain, a stateless single-shot inference call. The edge device owns the multi-turn agent loop and supplies full `contents` history per call.
- A cloud-side emergent-extraction pipeline (LLM-driven taxonomy proposal + `mergeManifestUpdates`). `cloud-agent` has no librarian/heal job; building one would mean porting/reimplementing `OntologyService`'s extraction logic server-side, which is a separate, much larger feature. Phase 1's `wiki_get_ontology_manifest` only ever reads what's already there (defaulting to `'off'`).
- Per-edge deletion propagation through `wikiSync` (only entity-wide hard-delete exists upstream via `bulkDeleteByEntityId`; no tombstone mechanism to sync per-edge removals).
- `core-llm-tools`' `buildAuthorizedToolsArray`/manifest-driven scoping for cloud-agent's ADK tools — `cloud-agent` doesn't use that mechanism today (it's used in `functions/src/generateReply.ts` for `googleSearchManifest`, and in the edge's `shared/agent-tools-spec.ts`); introducing it to `cloud-agent` is out of scope here.
