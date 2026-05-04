# Mermaid CodeGraph Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate Mermaid call-graph diagrams per source module from the CodeGraph SQLite DB via `npm run docs:charts`.

**Architecture:** CJS Node script reads `.codegraph/codegraph.db` read-only with `better-sqlite3`, BFS-traverses `calls` edges up to 3 hops per function node, emits one `graph TD` Mermaid block per module folder into `docs/flowcharts/`.

**Tech Stack:** Node.js (CJS), `better-sqlite3`, SQLite (`.codegraph/codegraph.db`), Mermaid markdown

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `scripts/generate-charts.js` | Full chart generation script |
| Create | `__tests__/generate-charts.test.js` | Unit tests for pure functions |
| Create | `docs/flowcharts/README.md` | Explains how charts are generated |
| Modify | `package.json` | Add `docs:charts` script, add `better-sqlite3` devDep |

---

### Task 1: Install `better-sqlite3`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install the dependency**

```bash
npm install --save-dev better-sqlite3
```

Expected: `better-sqlite3` appears in `devDependencies` in `package.json`.

- [ ] **Step 2: Verify it loads**

```bash
node -e "const Database = require('better-sqlite3'); console.log('ok')"
```

Expected output: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3 devDependency for chart generation"
```

---

### Task 2: Core pure functions with tests

**Files:**
- Create: `__tests__/generate-charts.test.js`
- Create: `scripts/generate-charts.js` (pure functions only, no I/O)

- [ ] **Step 1: Write failing tests**

Create `__tests__/generate-charts.test.js`:

```js
const {
  sanitizeName,
  makeNodeId,
  makeNodeLabel,
  buildEdgeSet,
  renderMermaid,
} = require('../scripts/generate-charts')

describe('sanitizeName', () => {
  it('replaces non-alphanumeric chars with underscore', () => {
    expect(sanitizeName('foo-bar.ts')).toBe('foo_bar_ts')
  })
  it('leaves clean names unchanged', () => {
    expect(sanitizeName('fooBar')).toBe('fooBar')
  })
})

describe('makeNodeId', () => {
  it('combines sanitized name and file', () => {
    expect(makeNodeId('getDatabase', 'src/database/index.ts')).toBe('getDatabase_src_database_index_ts')
  })
})

describe('makeNodeLabel', () => {
  it('returns name and basename', () => {
    expect(makeNodeLabel('getDatabase', 'src/database/index.ts')).toBe('getDatabase\n(index.ts)')
  })
})

describe('buildEdgeSet', () => {
  it('collects direct call edges', () => {
    const rows = [
      { source_name: 'a', source_file: 'src/x.ts', target_name: 'b', target_file: 'src/y.ts' },
    ]
    const edges = buildEdgeSet(rows)
    expect(edges).toEqual([
      {
        sourceId: 'a_src_x_ts',
        sourceLabel: 'a\n(x.ts)',
        targetId: 'b_src_y_ts',
        targetLabel: 'b\n(y.ts)',
      },
    ])
  })
  it('deduplicates identical edges', () => {
    const row = { source_name: 'a', source_file: 'src/x.ts', target_name: 'b', target_file: 'src/y.ts' }
    const edges = buildEdgeSet([row, row])
    expect(edges).toHaveLength(1)
  })
})

describe('renderMermaid', () => {
  it('wraps edges in graph TD block', () => {
    const edges = [
      { sourceId: 'a_x', sourceLabel: 'a\n(x.ts)', targetId: 'b_y', targetLabel: 'b\n(y.ts)' },
    ]
    const result = renderMermaid('database', edges)
    expect(result).toContain('# database call graph')
    expect(result).toContain('graph TD')
    expect(result).toContain('a_x["a\n(x.ts)"] --> b_y["b\n(y.ts)"]')
  })
  it('returns empty-graph notice when no edges', () => {
    const result = renderMermaid('machines', [])
    expect(result).toContain('_No call edges found')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx jest __tests__/generate-charts.test.js --no-coverage
```

Expected: FAIL — `Cannot find module '../scripts/generate-charts'`

- [ ] **Step 3: Create `scripts/generate-charts.js` with pure functions**

```js
#!/usr/bin/env node
'use strict'

const path = require('path')

// --- Pure functions ---

function sanitizeName(str) {
  return str.replace(/[^A-Za-z0-9_]/g, '_')
}

function makeNodeId(name, filePath) {
  return sanitizeName(name) + '_' + sanitizeName(filePath)
}

function makeNodeLabel(name, filePath) {
  return name + '\n(' + path.basename(filePath) + ')'
}

/**
 * @param {{ source_name, source_file, target_name, target_file }[]} rows
 * @returns {{ sourceId, sourceLabel, targetId, targetLabel }[]}
 */
function buildEdgeSet(rows) {
  const seen = new Set()
  const edges = []
  for (const row of rows) {
    const sourceId = makeNodeId(row.source_name, row.source_file)
    const targetId = makeNodeId(row.target_name, row.target_file)
    const key = sourceId + '->' + targetId
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({
      sourceId,
      sourceLabel: makeNodeLabel(row.source_name, row.source_file),
      targetId,
      targetLabel: makeNodeLabel(row.target_name, row.target_file),
    })
  }
  return edges
}

function renderMermaid(moduleName, edges) {
  const header = [
    `# ${moduleName} call graph`,
    '',
    '_Auto-generated. Run `npm run docs:charts` to regenerate._',
    '',
  ].join('\n')

  if (edges.length === 0) {
    return header + '_No call edges found for this module._\n'
  }

  const lines = edges.map(
    (e) => `  ${e.sourceId}["${e.sourceLabel}"] --> ${e.targetId}["${e.targetLabel}"]`,
  )

  return header + '```mermaid\ngraph TD\n' + lines.join('\n') + '\n```\n'
}

module.exports = { sanitizeName, makeNodeId, makeNodeLabel, buildEdgeSet, renderMermaid }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/generate-charts.test.js --no-coverage
```

Expected: PASS — 7 tests passing

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-charts.js __tests__/generate-charts.test.js
git commit -m "feat: add pure functions for mermaid chart generation with tests"
```

---

### Task 3: DB query and BFS traversal

**Files:**
- Modify: `scripts/generate-charts.js` (add `queryModuleEdges`, `main`)

- [ ] **Step 1: Write failing test for `queryModuleEdges`**

Add to `__tests__/generate-charts.test.js`:

```js
const { queryModuleEdges } = require('../scripts/generate-charts')

describe('queryModuleEdges', () => {
  it('returns rows with source/target names and file paths', () => {
    // mock db with .prepare().all() interface
    const mockRows = [
      { source_name: 'getDatabase', source_file: 'src/database/index.ts', target_name: 'openDatabaseAsyncWithRetry', target_file: 'src/database/index.ts' },
    ]
    const mockDb = {
      prepare: () => ({ all: () => mockRows }),
    }
    const result = queryModuleEdges(mockDb, 'src/database/%', 3)
    expect(result).toEqual(mockRows)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest __tests__/generate-charts.test.js --no-coverage
```

Expected: FAIL — `queryModuleEdges is not a function`

- [ ] **Step 3: Implement `queryModuleEdges` and update exports**

Add the function to `scripts/generate-charts.js` before the `module.exports` line, then replace the `module.exports` line to include it:

```js
/**
 * Walk `calls` edges from all function nodes in a module up to `maxDepth` hops.
 * Filters out targets outside `src/` (external libs).
 *
 * Uses recursive CTEs for BFS inside SQLite — single round-trip regardless of depth.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} moduleGlob e.g. 'src/database/%'
 * @param {number} maxDepth
 * @returns {{ source_name, source_file, target_name, target_file }[]}
 */
function queryModuleEdges(db, moduleGlob, maxDepth) {
  const sql = `
    WITH RECURSIVE bfs(source_id, target_id, depth) AS (
      -- seed: all calls edges from function nodes in this module
      SELECT e.source, e.target, 1
      FROM edges e
      JOIN nodes n ON e.source = n.id
      WHERE e.kind = 'calls'
        AND n.kind = 'function'
        AND n.file_path LIKE ?

      UNION

      -- recurse: follow calls from targets already in BFS
      SELECT e.source, e.target, bfs.depth + 1
      FROM edges e
      JOIN bfs ON e.source = bfs.target_id
      WHERE e.kind = 'calls'
        AND bfs.depth < ?
    )
    SELECT DISTINCT
      ns.name  AS source_name,
      ns.file_path AS source_file,
      nt.name  AS target_name,
      nt.file_path AS target_file
    FROM bfs
    JOIN nodes ns ON bfs.source_id = ns.id
    JOIN nodes nt ON bfs.target_id = nt.id
    WHERE nt.file_path LIKE 'src/%'
  `
  return db.prepare(sql).all(moduleGlob, maxDepth)
}

module.exports = { sanitizeName, makeNodeId, makeNodeLabel, buildEdgeSet, renderMermaid, queryModuleEdges }
```

Delete the old `module.exports` line that doesn't include `queryModuleEdges`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx jest __tests__/generate-charts.test.js --no-coverage
```

Expected: PASS — 8 tests passing

- [ ] **Step 5: Commit**

```bash
git add scripts/generate-charts.js __tests__/generate-charts.test.js
git commit -m "feat: add BFS query for module call edges via recursive CTE"
```

---

### Task 4: `main` function and npm script

**Files:**
- Modify: `scripts/generate-charts.js` (add `main`, `if require.main === module` entry)
- Modify: `package.json` (add `docs:charts` script)

- [ ] **Step 1: Add `main` and wire entry point**

At the top of `scripts/generate-charts.js`, add `const fs = require('fs')` after the existing `const path = require('path')` line.

Then append below the existing `module.exports` line:

```js
const MODULES = [
  { name: 'database',   glob: 'src/database/%' },
  { name: 'services',   glob: 'src/services/%' },
  { name: 'hooks',      glob: 'src/hooks/%' },
  { name: 'machines',   glob: 'src/machines/%' },
  { name: 'components', glob: 'src/components/%' },
]

const MAX_DEPTH = 3
const OUT_DIR = 'docs/flowcharts'

function main() {
  const dbPath = '.codegraph/codegraph.db'
  if (!fs.existsSync(dbPath)) {
    console.error('CodeGraph not initialized. Run: codegraph index')
    process.exit(1)
  }

  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })

  fs.mkdirSync(OUT_DIR, { recursive: true })

  for (const mod of MODULES) {
    const rows = queryModuleEdges(db, mod.glob, MAX_DEPTH)
    const edges = buildEdgeSet(rows)
    const content = renderMermaid(mod.name, edges)
    const outPath = `${OUT_DIR}/${mod.name}.md`
    fs.writeFileSync(outPath, content, 'utf8')
    console.log(`  wrote ${outPath} (${edges.length} edges)`)
  }

  db.close()
  console.log('Done.')
}

if (require.main === module) {
  main()
}
```

- [ ] **Step 2: Add npm script to `package.json`**

In `package.json`, add to the `"scripts"` object:

```json
"docs:charts": "node scripts/generate-charts.js"
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

```bash
npx jest __tests__/generate-charts.test.js --no-coverage
```

Expected: PASS — 8 tests passing

- [ ] **Step 4: Run the script end-to-end**

```bash
npm run docs:charts
```

Expected output:
```
  wrote docs/flowcharts/database.md (N edges)
  wrote docs/flowcharts/services.md (N edges)
  wrote docs/flowcharts/hooks.md (N edges)
  wrote docs/flowcharts/machines.md (N edges)
  wrote docs/flowcharts/components.md (N edges)
Done.
```

- [ ] **Step 5: Spot-check one output file**

```bash
head -20 docs/flowcharts/database.md
```

Expected: starts with `# database call graph`, contains `graph TD` and Mermaid edge lines.

- [ ] **Step 6: Commit**

```bash
git add scripts/generate-charts.js package.json
git commit -m "feat: add main() entrypoint and docs:charts npm script"
```

---

### Task 5: Write `docs/flowcharts/README.md` and commit generated charts

**Files:**
- Create: `docs/flowcharts/README.md`
- Add: `docs/flowcharts/*.md` (generated)

- [ ] **Step 1: Create README**

Create `docs/flowcharts/README.md`:

```markdown
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
```

- [ ] **Step 2: Commit everything**

```bash
git add docs/flowcharts/
git commit -m "docs: add auto-generated mermaid call graphs and README"
```

---

### Task 6: Full test suite check

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: existing tests pass, `generate-charts` tests pass, no regressions.

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors (script is plain JS, not in TS compilation scope).
