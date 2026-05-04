# Flowcharts

Auto-generated Mermaid call-graph diagrams, one per source module.

## Regenerating

```bash
npm run docs:charts
```

Requires `.codegraph/codegraph.db` to exist. If missing, run:

```bash
codegraph index
```

## Files

| File | Source module |
|---|---|
| `database.md` | `src/database/` |
| `services.md` | `src/services/` |
| `hooks.md` | `src/hooks/` |
| `machines.md` | `src/machines/` |
| `components.md` | `src/components/` |

## Notes

- Charts show call edges up to 3 hops from each function node.
- External library calls are excluded; only edges within `src/` are shown.
- Node labels: `functionName\n(filename.ts)`.
- Do not edit these files manually — they will be overwritten on next run.
