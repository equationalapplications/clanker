#!/usr/bin/env node
'use strict'

const path = require('path')

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
