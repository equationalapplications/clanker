#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')

const DIRECTORIES = ['components', 'database', 'hooks', 'machines', 'services']
const OVERVIEW_FILE = 'docs/flowcharts/overview.md'

/**
 * Query file-to-file dependency edges within a single src/ directory.
 * Excludes utilities, types, config, and self-referential edges.
 * Returns deduplicated {sourceFile, targetFile} pairs (no extensions).
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} directory - one of DIRECTORIES
 * @returns {{ sourceFile: string, targetFile: string }[]}
 */
function queryFileEdges(db, directory) {
  const sql = `
    SELECT ns.file_path AS src_path, nt.file_path AS tgt_path
    FROM edges e
    JOIN nodes ns ON e.source = ns.id
    JOIN nodes nt ON e.target = nt.id
    WHERE e.kind = 'calls'
      AND ns.file_path LIKE ?
      AND ns.file_path NOT LIKE '%/utilities/%'
      AND ns.file_path NOT LIKE '%/types/%'
      AND ns.file_path NOT LIKE '%/config/%'
      AND nt.file_path NOT LIKE '%/utilities/%'
      AND nt.file_path NOT LIKE '%/types/%'
      AND nt.file_path NOT LIKE '%/config/%'
  `
  const rows = db.prepare(sql).all(`src/${directory}/%`)

  const seen = new Set()
  const result = []

  for (const row of rows) {
    const sourceFile = path.basename(row.src_path).replace(/\.[^.]+$/, '')
    const targetFile = path.basename(row.tgt_path).replace(/\.[^.]+$/, '')

    if (sourceFile === targetFile) continue

    const key = `${sourceFile}|${targetFile}`
    if (!seen.has(key)) {
      seen.add(key)
      result.push({ sourceFile, targetFile })
    }
  }

  return result
}

/**
 * Render a file-level Mermaid graph LR block for a directory.
 *
 * @param {string} directory
 * @param {{ sourceFile: string, targetFile: string }[]} edges
 * @returns {string}
 */
function renderFileChart(directory, edges) {
  const header = [
    `# ${directory} file dependencies`,
    '',
    '_Auto-generated. Run `npm run docs:charts` to regenerate._',
    '',
  ].join('\n')

  if (edges.length === 0) {
    return header + '_No edges found._\n'
  }

  const lines = edges.map((e) => `  ${e.sourceFile} --> ${e.targetFile}`)
  return header + '```mermaid\ngraph LR\n' + lines.join('\n') + '\n```\n'
}

module.exports = { queryFileEdges, renderFileChart }

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

    for (const dir of DIRECTORIES) {
      const edges = queryFileEdges(db, dir)
      const content = renderFileChart(dir, edges)
      const outFile = `docs/flowcharts/${dir}.md`
      fs.writeFileSync(outFile, content, 'utf8')
      console.log(`  wrote ${outFile} (${edges.length} file edges)`)
    }

    if (fs.existsSync(OVERVIEW_FILE)) {
      fs.unlinkSync(OVERVIEW_FILE)
      console.log(`  deleted ${OVERVIEW_FILE}`)
    }
  } finally {
    db.close()
  }

  console.log('Done.')
}

if (require.main === module) {
  main()
}
