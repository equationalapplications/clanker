# Curated Schema.org Ontology for Clanker Warm-Agent — Design

**Date:** 2026-07-14 (revised same day to adopt the published manifest package)
**Status:** Design Complete (Pending Implementation)
**Branch:** `feat/schema`
**Depends on:** `@equationalapplications/schema-org-llm-wiki` 4.22.0, `@equationalapplications/expo-llm-wiki` / `core-llm-wiki` 4.22.0+ (triple-keyed edge validation)

---

## Executive Summary

Clanker's warm-agent memory system needs a lightweight, high-precision ontology to type facts as they enter the knowledge graph. The ontology itself — a **9-node, 28-edge Schema.org-aligned manifest** — is now published as `@equationalapplications/schema-org-llm-wiki@4.22.0` (export: `schemaOrgWarmAgentManifest`), designed in the expo-llm-wiki spec `2026-07-14-polymorphic-edge-triples-schema-org-package-spec.md`. This document covers Clanker's adoption of that package: why this ontology fits the warm-agent domain, and how it deploys through Clanker's edge/cloud sync architecture.

**Key properties:**
- All types and properties are Schema.org-standard (future JSON-LD export compatibility)
- 9 node types fit easily in LLM context (~2KB manifest, ~500 tokens per prompt)
- 28 edges cover the full warm-agent domain; polymorphic Schema.org properties (`location`, `organizer`, `about`, `itemReviewed`) appear as multiple `(type, source, target)` rows, supported natively since core 4.22.0's triple-keyed edge validation
- Strict mode (no type drift) — types are curated, not emergent
- No "self" super-nodes — implicit character ownership keeps graph clean
- Single source of truth: Clanker imports the manifest, never redefines it

---

## Problem Statement

### The Ontology Constraint

Clanker's manifest model is built for small, curated vocabularies. The manifest injects verbatim into every LLM prompt (`OntologyPromptContext.ontologyManifest`), which enforces two requirements:

1. **Prompt injection scaling:** The manifest must remain small enough that token cost per LLM call stays acceptable (user credits, model latency).
2. **LLM classification accuracy:** More types = harder classification = more hallucination. A tight type space (10–20 types) performs reliably; 800+ types degrade rapidly.

### Why Full Schema.org Doesn't Fit

Schema.org has ~800 types and ~1,400 properties in a deep hierarchy. Direct adoption would:

- **Blow prompt tokens:** 300+ KB injected per call (unsustainable)
- **Require subsumption logic:** Schema.org has inheritance (Recipe < CreativeWork < Thing); the manifest model is flat
- **Demand LLM redesign:** Classification accuracy would collapse on an 800-way choice

### The Solution: Curated Subset, Published as a Package

Select 9 high-value Schema.org types relevant to the warm-agent domain and express their standard properties — including polymorphic ones — as 28 concrete edge rows. Core 4.22.0 keys edge uniqueness on the `(type, source_type, target_type)` triple, so one property name may legally appear with multiple domain/range pairs, exactly as Schema.org defines it. The manifest ships as `@equationalapplications/schema-org-llm-wiki` so Clanker (and any other consumer) imports one constant instead of maintaining a private copy.

---

## Design Decisions

### 1. Node Type Selection (9 types)

The 9 types balance coverage across four knowledge domains:

| Domain | Types | Purpose |
|--------|-------|---------|
| **Identity & Social** | `person`, `organization` | User's social graph (friends, family, colleagues, institutions) |
| **Spatial & Temporal** | `place`, `event` | Locations and scheduled/historical events |
| **Execution** | `project`, `action` | Goals, initiatives, and individual tasks/steps |
| **Content & Opinion** | `creativework`, `review`, `product` | Media consumption, possessions, and personal evaluations |

**Omitted types and rationale:**
- `Goal` — not Schema.org-standard; use `Project` (goals are multi-step initiatives) or `Action` (atomic tasks)
- `LocalBusiness`, `SportsTeam`, `Team` — special cases of `Organization`; unified under one type reduces classification load
- `Article`, `VideoObject` — subtypes of `CreativeWork`; LLM can extract video-specific properties inside a `CreativeWork` fact if needed
- `Rating`, `AggregateRating` — in Schema.org, `itemReviewed` is a property of `Review` (and `AggregateRating`), not `Rating`. The manifest uses `review` as the opinion node; numeric rating values stay inside the fact content

### 2. Edge Design (28 edges)

All 28 edges are Schema.org-standard properties with standard domain/range. Two principles:

**Implicit subject ownership:** Personal wiki facts are implicitly scoped to one character. Explicit "self" edges (like `Review.author → Person`) create a super-node "Me" that clutters the graph and provides zero new information. Omitted.

**Polymorphic properties stay polymorphic:** `location`, `organizer`, `about`, and `itemReviewed` each appear as multiple rows with distinct source/target types. No renaming or flattening — the triple-keyed validation in core 4.22.0 accepts them, and edge resolution disambiguates by the source fact's type and the resolved target's type.

The authoritative edge list is `schemaOrgWarmAgentManifest.edge_types` in the package source. Summary by section:

#### A. Identity & Social (5 edges)

| Edge | Source | Target | Notes |
|------|--------|--------|-------|
| `knows` | person | person | Friendship, acquaintance, or general connection |
| `spouse` | person | person | Spousal or long-term partner relationship |
| `parent` | person | person | Source is the **child**, target is the parent (Schema.org direction) |
| `worksFor` | person | organization | Employment or primary professional affiliation |
| `memberOf` | person | organization | Clubs, associations, communities |

#### B. Spatial Mapping (5 edges)

| Edge | Source | Target | Notes |
|------|--------|--------|-------|
| `homeLocation` | person | place | Primary residence |
| `workLocation` | person | place | Workplace |
| `location` | event | place | Event venue |
| `location` | organization | place | Headquarters or primary location |
| `containedInPlace` | place | place | Source place is inside target place ("Paris is contained in France") |

#### C. Execution & Productivity (6 edges)

| Edge | Source | Target | Notes |
|------|--------|--------|-------|
| `subOrganization` | project | project | Target is a sub-project of source (Schema.org: Project ⊂ Organization, so `subOrganization` is the standard containment property; `subProject` does not exist in Schema.org) |
| `object` | action | project | The project this task advances |
| `agent` | action | person | Person responsible for or performing the action |
| `attendee` | event | person | Schema.org Event uses `attendee`, not `participant` |
| `organizer` | event | person | Person who organized the event |
| `organizer` | event | organization | Organization hosting the event |

#### D. Intellectual & Media (6 edges)

| Edge | Source | Target | Notes |
|------|--------|--------|-------|
| `author` | creativework | person | Author, creator, artist, filmmaker |
| `publisher` | creativework | organization | Publisher, platform, studio, distributor |
| `about` | creativework | person | Content centered on a person |
| `about` | creativework | organization | Content centered on a company or group |
| `about` | creativework | place | Travel guide, local history |
| `about` | creativework | event | Documentary, article about an event |

#### E. Subjective Sentiment (5 edges)

| Edge | Source | Target | Notes |
|------|--------|--------|-------|
| `itemReviewed` | review | creativework | Review of a book, movie, article |
| `itemReviewed` | review | organization | Review of a business, restaurant |
| `itemReviewed` | review | place | Evaluation of a venue, park, location |
| `itemReviewed` | review | event | Opinion of an attended event |
| `itemReviewed` | review | product | Opinion of a tool, device, product |

#### F. Possessions (1 edge)

| Edge | Source | Target | Notes |
|------|--------|--------|-------|
| `owns` | person | product | Item owned (electronics, vehicles, etc.) |

---

## Manifest Source of Truth

Clanker does **not** define the manifest. It imports it:

```ts
import { schemaOrgWarmAgentManifest } from '@equationalapplications/schema-org-llm-wiki'
```

The package (expo-llm-wiki monorepo, `packages/schema-org`) exports:
- `schemaOrgWarmAgentManifest: OntologyManifest` — the 9-node / 28-edge constant
- Re-exported types: `OntologyManifest`, `OntologyNodeType`, `OntologyEdgeType` (from `@equationalapplications/core-llm-wiki`)

Casing note: edge names keep Schema.org camelCase (`worksFor`, `itemReviewed`). Validation compares case-insensitively but persists the manifest's casing, so stored `edge_type` values map 1:1 to Schema.org property names for future JSON-LD export.

---

## Deployment Path (Clanker Adoption)

### Where the manifest lives at runtime

The ontology manifest is stored per character in cloud Postgres (`llm_wiki_ontology`, `functions/src/wikiSync.ts`) and per entity in edge SQLite. `characterSyncService` already syncs it both directions: the edge sends its local manifest in the sync bundle, and writes `cloudBundle.ontology` back via `wiki.setOntologyManifest(...)`. **No manifest is seeded anywhere today** — every character currently resolves to mode `off`.

### Adoption steps

1. **Bump dependencies:** `@equationalapplications/expo-llm-wiki` and `@equationalapplications/core-llm-wiki` to `^4.22.0`; add `@equationalapplications/schema-org-llm-wiki@^4.22.0`.
2. **Seed on the edge:** in `characterSyncService`, when a character has no stored manifest (`wiki.getOntologyManifest(char.id)` returns nothing and the cloud bundle carries none), call `wiki.setOntologyManifest(char.id, schemaOrgWarmAgentManifest, { mode: 'strict' })` before the existing `runOntologyBackfill(char.id)` call. The next sync propagates the manifest to cloud Postgres automatically.
3. **Backfill:** the already-adopted `runOntologyBackfill` (feat/ontology-backfill-adoption) types pre-ontology facts against the seeded manifest — one batch per sync, backlog converges across syncs.
4. **Librarian & ingest:** existing prompt templates accept arbitrary manifests; no changes. The 4.22.0 prompt appendix already explains polymorphic edge rows to the extraction model.
5. **Cloud agent:** `wiki_get_ontology_manifest` and `wiki_traverse_graph` (cloud-agent) read the synced Postgres row; no changes needed.

Exact code changes, tests, and rollout order belong to the implementation plan (follow-up to this design).

### LLM Prompt Injection

- **Manifest size:** ~2KB serialized JSON
- **Token cost:** ~500 tokens per prompt (negligible vs. context limit)
- **Classification space:** 9 types → very high accuracy, minimal hallucination

### Graph Traversal Compatibility

- `wiki_traverse_graph` (edge and cloud) already supports edge-type-filtered reads
- Facts typed with this manifest are immediately queryable by type and edge
- Pre-ontology or untyped facts continue to be processed by backfill

### JSON-LD Export Future-Proofing

All node types and properties are Schema.org-standard with standard domain/range. Future JSON-LD export can map directly to schema.org/Thing subtypes without translation or loss of fidelity.

---

## Testing Strategy

Manifest correctness (9 types present, 28 valid edges, no duplicate triples, snapshot) is tested **in the package** (`packages/schema-org/__tests__/manifest.test.ts`) — Clanker does not re-test the constant. Clanker's tests cover the adoption seam:

### Unit: Seeding
- New character with no local or cloud manifest → `setOntologyManifest` called with `schemaOrgWarmAgentManifest`, mode `strict`
- Character with existing manifest (local or from cloud bundle) → seed skipped, existing manifest wins
- Seed failure is reported (existing `reportWikiOpForCharacter` path), sync continues

### Integration: LLM Classification
- Backfill and librarian prompts with this manifest classify facts into the 9 types
- Sample 50 real warm-agent memory facts; confirm edge assignments, including polymorphic cases (`itemReviewed` resolving to different targets, `location` on event vs. organization)

### System: Graph Queries
- `wiki_traverse_graph` filters correctly by type and edge on both edge and cloud
- Queries like "all people Alice knows", "all restaurants Alice reviewed", "all projects containing this task"
- Pre-ontology facts backfill into this schema without type conflicts

---

## Out of Scope (v1)

- **Type hierarchy/inheritance:** the manifest is flat. If subsumption becomes necessary later, add an optional `parent` field to `OntologyNodeType` (library change).
- **Emergent mode:** strict only for v1. Emergent can be enabled later with guardrails.
- **Literal-valued properties:** properties like `birthDate`, `startTime`, `name`, and numeric rating values remain inside fact content, not as edges. Only object-valued properties (pointing to other facts) map to edges.
- **Manifest customization per character:** every character seeds the same manifest in v1.

---

## Appendix: Schema.org Alignment

| Clanker Type | Schema.org | Notes |
|--------------|-----------|-------|
| `person` | schema.org/Person | ✓ Standard |
| `organization` | schema.org/Organization | ✓ Standard (covers Company, SportsTeam, LocalBusiness, School, etc.) |
| `place` | schema.org/Place | ✓ Standard (covers City, Landmark, PostalAddress, etc.) |
| `event` | schema.org/Event | ✓ Standard |
| `project` | schema.org/Project | ✓ Standard (subtype of Organization — hence `subOrganization` for nesting) |
| `action` | schema.org/Action | ✓ Standard |
| `creativework` | schema.org/CreativeWork | ✓ Standard (parent of Article, VideoObject, Movie, Book, etc.) |
| `review` | schema.org/Review | ✓ Standard (`itemReviewed` domain includes Review; Rating has no such property) |
| `product` | schema.org/Product | ✓ Standard |

All 28 edge properties are Schema.org-standard with standard domain/range definitions; polymorphic domain/range pairs are preserved as separate manifest rows rather than renamed.

---

## References

- Manifest package: `@equationalapplications/schema-org-llm-wiki@4.22.0` (expo-llm-wiki monorepo, `packages/schema-org/src/index.ts`, export `schemaOrgWarmAgentManifest`)
- Library spec: expo-llm-wiki `docs/superpowers/specs/2026-07-14-polymorphic-edge-triples-schema-org-package-spec.md` (triple-keyed edge validation + package)
- Ontology types: `OntologyManifest` / `OntologyConfig` in `@equationalapplications/core-llm-wiki` (`packages/core/src/types.ts`)
- Clanker sync + backfill call site: `src/services/characterSyncService.ts`
- Cloud manifest storage: `functions/src/wikiSync.ts` (`llm_wiki_ontology`), cloud-agent read tools: `cloud-agent/src/tools/ontology.ts`
- Prior spec: `2026-07-14-ontology-backfill-adoption-design.md` (ontology backfill adoption)
- Schema.org: https://schema.org/
- Architecture context: `docs/architecture-and-data.md`
