import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import type { OkfFile } from '../okfImport'

const FIXTURES_ROOT = path.resolve(__dirname, 'fixtures')

function walkMd(dir: string, prefix = ''): string[] {
  return fs.readdirSync(dir).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry}` : entry
    const full = path.join(dir, entry)
    if (fs.statSync(full).isDirectory()) return walkMd(full, rel)
    return rel.endsWith('.md') ? [rel] : []
  })
}

export function loadOkfFixture(name: 'golden-v1' | 'legacy-profile-0'): OkfFile[] {
  const root = path.join(FIXTURES_ROOT, name)
  return walkMd(root)
    .sort()
    .map((rel) => ({ path: rel, content: fs.readFileSync(path.join(root, rel), 'utf8') }))
}

export function fixtureChecksum(name: 'golden-v1' | 'legacy-profile-0'): string {
  const hash = crypto.createHash('sha256')
  for (const file of loadOkfFixture(name)) {
    hash.update(file.path)
    hash.update('\0')
    hash.update(file.content)
    hash.update('\0')
  }
  return hash.digest('hex')
}
