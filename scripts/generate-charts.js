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
  return name.replace(/"/g, "'") + '\n(' + path.basename(filePath) + ')'
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
