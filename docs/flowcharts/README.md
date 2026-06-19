# Flowcharts

Architecture diagrams for the Clanker codebase. Two types:

## C4 Architecture (manual)

High-level diagrams maintained by hand. Update when system boundaries or integrations change.

| File | Description |
|---|---|
| `c4/system-context.md` | Level 1: Clanker and its external dependencies |
| `c4/containers.md` | Level 2: Internal containers (app, functions, databases) |

## Dependency Overview (auto-generated)

File-level dependency graphs for each core source module. Show which files within a directory call into which other files across the codebase. Excludes utilities, types, and config from both source and target.

| File | Module |
|---|---|
| `COMPONENTS.md` | `src/components/` |
| `DATABASE.md` | `src/database/` |
| `HOOKS.md` | `src/hooks/` |
| `MACHINES.md` | `src/machines/` |
| `SERVICES.md` | `src/services/` |

Regenerate with:

```bash
npm run docs:charts
```

Requires `.codegraph/codegraph.db`. If missing:

```bash
codegraph index
```

## Notes

- Files above are auto-generated — do not edit manually.
- C4 files in `c4/` are manually maintained.
- The script excludes `utilities/`, `types/`, and `config/` from both source and target sides.
