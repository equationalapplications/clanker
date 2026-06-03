#!/usr/bin/env node
'use strict'

const fs = require('fs')

/**
 * Query all src/ folder-to-folder dependency edges via CodeGraph.
 * Maps each file_path to its top-level src/ subdirectory.
 * Excludes utilities, types, config, and src-root files.
 * Returns deduplicated {s_dir, t_dir} pairs.
 *
 * @param {import('better-sqlite3').Database} db
 * @returns {{ s_dir: string, t_dir: string }[]}
 */
function queryFolderEdges(db) {
  const sql = `
    SELECT DISTINCT s_dir, t_dir FROM (
      SELECT
        CASE
          WHEN instr(substr(ns.file_path, 5), '/') > 0
          THEN substr(ns.file_path, 5, instr(substr(ns.file_path, 5), '/') - 1)
          ELSE 'root'
        END AS s_dir,
        CASE
          WHEN instr(substr(nt.file_path, 5), '/') > 0
          THEN substr(nt.file_path, 5, instr(substr(nt.file_path, 5), '/') - 1)
          ELSE 'root'
        END AS t_dir
      FROM edges e
      JOIN nodes ns ON e.source = ns.id
      JOIN nodes nt ON e.target = nt.id
      WHERE e.kind = 'calls'
        AND ns.file_path LIKE 'src/%'
        AND nt.file_path LIKE 'src/%'
    )
    WHERE s_dir NOT IN ('utilities', 'types', 'config', 'root')
      AND t_dir NOT IN ('utilities', 'types', 'config', 'root')
      AND s_dir != t_dir
  `
  return db.prepare(sql).all()
}

/**
 * Render a folder-level Mermaid graph LR overview.
 *
 * @param {{ s_dir: string, t_dir: string }[]} edges
 * @returns {string}
 */
function renderFolderOverview(edges) {
  const header = [
    '# Source folder dependencies',
    '',
    '_Auto-generated. Run `npm run docs:charts` to regenerate._',
    '',
  ].join('\n')

  if (edges.length === 0) {
    return header + '_No folder-level edges found._\n'
  }

  const lines = edges.map((e) => `  ${e.s_dir} --> ${e.t_dir}`)
  return header + '```mermaid\ngraph LR\n' + lines.join('\n') + '\n```\n'
}

module.exports = { queryFolderEdges, renderFolderOverview }

const OLD_FILES = [
  'docs/flowcharts/database.md',
  'docs/flowcharts/services.md',
  'docs/flowcharts/hooks.md',
  'docs/flowcharts/machines.md',
  'docs/flowcharts/components.md',
]

const OUT_FILE = 'docs/flowcharts/overview.md'

function main() {
  const dbPath = '.codegraph/codegraph.db'
  if (!fs.existsSync(dbPath)) {
    console.error('CodeGraph not initialized. Run: codegraph index')
    process.exit(1)
  }

  const Database = require('better-sqlite3')
  const db = new Database(dbPath, { readonly: true })

  try {
    fs.mkdirSync('docs/flowcharts', { recursive: true })

    const edges = queryFolderEdges(db)
    const content = renderFolderOverview(edges)
    fs.writeFileSync(OUT_FILE, content, 'utf8')
    console.log(`  wrote ${OUT_FILE} (${edges.length} folder edges)`)

    for (const f of OLD_FILES) {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f)
        console.log(`  deleted ${f}`)
      }
    }
  } finally {
    db.close()
  }

  console.log('Done.')
}

if (require.main === module) {
  main()
}
