#!/usr/bin/env node
'use strict'

const path = require('path')
const fs = require('fs')

// --- Pure functions ---

function sanitizeName(str) {
  const s = str.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[0-9]/.test(s) ? '_' + s : s
}

function makeNodeId(name, filePath) {
  return sanitizeName(name) + '__' + sanitizeName(filePath)
}

function makeNodeLabel(name, filePath) {
  const raw = name + '\n(' + path.basename(filePath) + ')'
  return raw.replace(/"/g, "'")
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

function renderMermaid(moduleName, edges, title) {
  const chartTitle = title != null ? title : `${moduleName} call graph`
  const header = [
    `# ${chartTitle}`,
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

  return header + '```mermaid\ngraph LR\n' + lines.join('\n') + '\n```\n'
}

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
  // UNION deduplicates on (source_id, target_id, depth) — not just the pair.
  // SQLite does not support self-referential NOT EXISTS in recursive CTEs,
  // so we cannot deduplicate on the pair alone. The depth cap ensures termination.
  // SELECT DISTINCT in the outer query produces deduplicated output rows.
  return db.prepare(sql).all(moduleGlob, maxDepth)
}

/**
 * Query project-local imports (~/...) for all files in a module.
 * Used as fallback for modules with no call edges (e.g. XState machines).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} moduleGlob e.g. 'src/machines/%'
 * @returns {{ source_file: string, import_path: string }[]}
 */
function queryModuleImports(db, moduleGlob) {
  const sql = `
    SELECT DISTINCT
      nf.file_path AS source_file,
      ni.name      AS import_path
    FROM edges e
    JOIN nodes nf ON e.source = nf.id
    JOIN nodes ni ON e.target = ni.id
    WHERE nf.file_path LIKE ?
      AND nf.kind = 'file'
      AND e.kind  = 'contains'
      AND ni.kind = 'import'
      AND ni.name LIKE '~/%'
  `
  return db.prepare(sql).all(moduleGlob)
}

/**
 * @param {{ source_file: string, import_path: string }[]} rows
 * @returns {{ sourceId, sourceLabel, targetId, targetLabel }[]}
 */
function buildImportEdgeSet(rows) {
  const seen = new Set()
  const edges = []
  for (const row of rows) {
    const sourceName = path.basename(row.source_file, path.extname(row.source_file))
    const segments = row.import_path.split('/')
    const targetName = segments[segments.length - 1]
    const targetDir = segments.slice(0, -1).join('/')
    const sourceId = makeNodeId(sourceName, row.source_file)
    const targetId = sanitizeName(row.import_path)
    const key = sourceId + '->' + targetId
    if (seen.has(key)) continue
    seen.add(key)
    edges.push({
      sourceId,
      sourceLabel: makeNodeLabel(sourceName, row.source_file),
      targetId,
      targetLabel: makeNodeLabel(targetName, targetDir),
    })
  }
  return edges
}

module.exports = { sanitizeName, makeNodeId, makeNodeLabel, buildEdgeSet, renderMermaid, queryModuleEdges, queryModuleImports, buildImportEdgeSet }

const MODULES = [
  { name: 'database',   glob: 'src/database/%' },
  { name: 'services',   glob: 'src/services/%' },
  { name: 'hooks',      glob: 'src/hooks/%' },
  { name: 'machines',   glob: 'src/machines/%' },
  { name: 'components', glob: 'src/components/%' },
]

const MAX_DEPTH = 2
const OUT_DIR = 'docs/flowcharts'

function main() {
  const dbPath = '.codegraph/codegraph.db'
  if (!fs.existsSync(dbPath)) {
    console.error('CodeGraph not initialized. Run: codegraph index')
    process.exit(1)
  }

  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true })

    for (const mod of MODULES) {
      let edges = buildEdgeSet(queryModuleEdges(db, mod.glob, MAX_DEPTH))
      let title
      if (edges.length === 0) {
        edges = buildImportEdgeSet(queryModuleImports(db, mod.glob))
        title = `${mod.name} import dependencies`
      }
      const content = renderMermaid(mod.name, edges, title)
      const outPath = `${OUT_DIR}/${mod.name}.md`
      fs.writeFileSync(outPath, content, 'utf8')
      console.log(`  wrote ${outPath} (${edges.length} edges)`)
    }
  } finally {
    db.close()
  }

  console.log('Done.')
}

if (require.main === module) {
  main()
}
