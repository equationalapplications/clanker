# Flowchart Improvements Design

_2026-06-03_

## Goal

Make `docs/flowcharts/` human-readable by adding high-level C4 architecture diagrams (manual) and simplifying the auto-generated charts (folder-level rollup instead of function-level).

## C4 Charts (manual)

Two new files in `docs/flowcharts/c4/`, written in Mermaid C4 syntax.

### Level 1 — System Context (`docs/flowcharts/c4/system-context.md`)

Diagram type: `C4Context`

Actors and systems:

| Element | Type | Notes |
|---|---|---|
| User | Person | Mobile or web |
| Clanker | System | The app itself |
| Firebase | System_Ext | Auth, Cloud Functions, Firestore |
| Google Sign-In | System_Ext | Identity provider |
| OpenAI | System_Ext | LLM responses via Cloud Functions |
| Stripe | System_Ext | Web subscription payments |
| RevenueCat | System_Ext | Mobile in-app purchases |
| Crashlytics | System_Ext | Error reporting |

Relations: User→Clanker (uses), Clanker→each external system.

### Level 2 — Containers (`docs/flowcharts/c4/containers.md`)

Diagram type: `C4Container`

Scope: inside Clanker.

| Container | Tech | Notes |
|---|---|---|
| Clanker App | Expo React Native (shared mobile/web) | Main client |
| Firebase Auth | Firebase | Identity, session tokens |
| Cloud Functions | Firebase Functions | Backend logic, AI orchestration |
| Cloud SQL | PostgreSQL via Functions | Relational store |
| Local SQLite | expo-sqlite | Offline-first on-device DB |
| Firestore | Firebase Firestore | Real-time sync, direct client reads |

Key relations:

- App → Firebase Auth (sign-in / token refresh)
- App → Cloud Functions (callable functions: chat, purchases, wiki)
- App → Firestore (direct real-time reads)
- App → Local SQLite (all local reads/writes)
- Cloud Functions → Cloud SQL (user data, subscriptions)
- Cloud Functions → OpenAI (LLM calls)
- Cloud Functions → RevenueCat (subscription validation)

## Simplified Auto-Generated Charts

### Output

Replace the five per-module files (`database.md`, `services.md`, `hooks.md`, `machines.md`, `components.md`) with a single `docs/flowcharts/overview.md`. One `graph LR` Mermaid diagram with folder-level nodes and edges.

Example output shape:
```
hooks --> services
hooks --> database
services --> database
components --> hooks
machines --> services
```

### Script changes (`scripts/generate-charts.js`)

**Query strategy:** Single SQL query across all file edges. Map each `file_path` to its top-level `src/` subdirectory using SQLite string functions. The existing script uses `e.kind = 'calls'` — implementation must verify available edge kinds in the DB (likely `calls` and `contains`; `imports` as an edge kind is unconfirmed). If only `calls` edges exist, the query uses `calls` only.

```sql
SELECT DISTINCT s_dir, t_dir FROM (
  SELECT
    substr(ns.file_path, 5, instr(substr(ns.file_path, 5), '/') - 1) AS s_dir,
    substr(nt.file_path, 5, instr(substr(nt.file_path, 5), '/') - 1) AS t_dir
  FROM edges e
  JOIN nodes ns ON e.source = ns.id
  JOIN nodes nt ON e.target = nt.id
  WHERE e.kind IN ('calls', 'imports')  -- verify 'imports' exists; use 'calls' only if not
    AND ns.file_path LIKE 'src/%'
    AND nt.file_path LIKE 'src/%'
)
WHERE s_dir NOT IN ('utilities', 'types', 'config')
  AND t_dir NOT IN ('utilities', 'types', 'config')
  AND s_dir != t_dir
  AND s_dir != ''
  AND t_dir != ''
```

**Exclusions:** `utilities`, `types`, `config` filtered from both source and target sides.

**Depth:** Implicit depth 1 — direct file-to-file edges only, no recursive traversal.

**Rendering:** `renderMermaid` simplified to emit plain `nodeName --> nodeName` lines (no node ID mangling, no label quoting needed for single-word directory names).

### README update

`docs/flowcharts/README.md` updated to:
- Point to `overview.md` instead of the five per-module files
- Document the `c4/` subdirectory and its two files
- Remove the per-module file table

## Files changed

| Action | Path |
|---|---|
| Create | `docs/flowcharts/c4/system-context.md` |
| Create | `docs/flowcharts/c4/containers.md` |
| Create | `docs/flowcharts/overview.md` (auto-generated) |
| Modify | `scripts/generate-charts.js` |
| Modify | `docs/flowcharts/README.md` |
| Delete | `docs/flowcharts/database.md` |
| Delete | `docs/flowcharts/services.md` |
| Delete | `docs/flowcharts/hooks.md` |
| Delete | `docs/flowcharts/machines.md` |
| Delete | `docs/flowcharts/components.md` |

## Out of scope

- C4 Level 3 (component diagrams) — not needed
- Rendering C4 charts to PNG/SVG — Mermaid in markdown is sufficient
- Changes to CodeGraph indexing
