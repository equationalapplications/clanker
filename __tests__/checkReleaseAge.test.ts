// Fail-closed regression tests for scripts/check-release-age.mjs.
// The script must exit nonzero when a lockfile yields no readable "packages"
// entries (lockfileVersion 1, truncated, or regenerated file) instead of
// passing silently ("Checked 0 packages" / "No dependency changes").
//
// Every case here exits before the script performs any registry fetch, so the
// suite is fully offline. The happy-path delta case (unchanged lockfile) also
// exits before fetching, which lets us cover the pass path without network.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

jest.setTimeout(30000)

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-release-age.mjs')

const VALID_LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    '': { name: 'fixture', dependencies: { foo: '1.2.3' } },
    'node_modules/foo': {
      version: '1.2.3',
      resolved: 'https://registry.npmjs.org/foo/-/foo-1.2.3.tgz',
    },
  },
})

const NO_PACKAGES_LOCK = JSON.stringify({ lockfileVersion: 1, name: 'fixture', version: '1.0.0' })

function runScript(args: string[], cwd: string) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' })
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'check-release-age-'))
}

function makeTempRepo(): string {
  const dir = makeTempDir()
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir })
  return dir
}

function commitFile(repoDir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(repoDir, name), content)
  execFileSync('git', ['add', name], { cwd: repoDir })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repoDir })
}

describe('check-release-age fail-closed on unreadable lockfiles', () => {
  it('whole-lockfile mode: exits 2 when the lockfile has no "packages" entries', () => {
    const dir = makeTempDir()
    try {
      fs.writeFileSync(path.join(dir, 'lock.json'), NO_PACKAGES_LOCK)
      const result = runScript(['--lockfile', 'lock.json'], dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('lock.json')
      expect(result.stderr).toContain('no "packages" entries')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('delta mode: exits 2 when the current lockfile has no "packages" entries', () => {
    const dir = makeTempRepo()
    try {
      commitFile(dir, 'base.json', VALID_LOCK)
      fs.writeFileSync(path.join(dir, 'cur.json'), NO_PACKAGES_LOCK)
      const result = runScript(['--base', 'HEAD', '--lockfile', 'cur.json'], dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('no "packages" entries')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('delta mode: exits 2 when the base lockfile has no "packages" entries', () => {
    const dir = makeTempRepo()
    try {
      commitFile(dir, 'lock.json', NO_PACKAGES_LOCK)
      fs.writeFileSync(path.join(dir, 'lock.json'), VALID_LOCK)
      const result = runScript(['--base', 'HEAD', '--lockfile', 'lock.json'], dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('HEAD:lock.json')
      expect(result.stderr).toContain('no "packages" entries')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('delta mode: unchanged lockfile still passes without a cooldown', () => {
    const dir = makeTempRepo()
    try {
      commitFile(dir, 'lock.json', VALID_LOCK)
      const result = runScript(['--base', 'HEAD', '--lockfile', 'lock.json'], dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No dependency changes')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
