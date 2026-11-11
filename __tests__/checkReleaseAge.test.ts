// Fail-closed regression tests for scripts/check-release-age.mjs.
// The script must exit nonzero when a lockfile yields no readable "packages"
// entries (lockfileVersion 1, truncated, or regenerated file) instead of
// passing silently ("Checked 0 packages" / "No dependency changes").
//
// Every registry-facing case runs the script with --registry pointed at a
// local in-process registry server (see startRegistry), so the suite is fully
// offline and deterministic: no test performs a network fetch, and fresh vs.
// old publish times are controlled by the fixture.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'

jest.setTimeout(30000)

const SCRIPT = path.join(__dirname, '..', 'scripts', 'check-release-age.mjs')

type Packument = { time: Record<string, string> }

// In-process stand-in for the npm registry. The script encodes scoped names
// as "@scope%2fname"; decodeURIComponent recovers the real name. A name
// absent from `docs` 404s, like the real registry would for an unpublished
// package.
function startRegistry(docs: Record<string, Packument>) {
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    const server = http.createServer((req, res) => {
      const name = decodeURIComponent((req.url ?? '/').slice(1))
      const doc = docs[name]
      if (!doc) {
        res.statusCode = 404
        res.end('not found')
        return
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify(doc))
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () =>
          new Promise((res, rej) => {
            server.close((err) => (err ? rej(err) : res()))
          }),
      })
    })
  })
}

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString()

// Isolate every spawned git invocation (fixture commands and the checker
// itself) from the ambient environment: strip all inherited GIT_* variables —
// repository locators like GIT_DIR/GIT_WORK_TREE would point `git init` and
// `git show` at some other repository, and hooks can leak them into child
// processes — then re-add config isolation (commit.gpgsign, core.hooksPath,
// aliases, templates) so a commit can't fail or block for reasons unrelated
// to the checker.
const ISOLATED_GIT_ENV: NodeJS.ProcessEnv = { ...process.env }
for (const key of Object.keys(ISOLATED_GIT_ENV)) {
  if (key.startsWith('GIT_')) delete ISOLATED_GIT_ENV[key]
}
// The checker reads its default --days from this; an ambient value would
// shift the cutoff the fixtures' publish times are built around.
delete ISOLATED_GIT_ENV.MIN_RELEASE_AGE_DAYS
ISOLATED_GIT_ENV.GIT_CONFIG_GLOBAL = '/dev/null'
ISOLATED_GIT_ENV.GIT_CONFIG_SYSTEM = '/dev/null'

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

// Spawned asynchronously, not spawnSync: the registry server above runs in
// this jest worker's event loop, which a synchronous spawn would block — the
// child's fetches to it would hang until the script's 30s fetch timeout.
function runScript(args: string[], cwd: string) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [SCRIPT, ...args], { cwd, env: ISOLATED_GIT_ENV })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => (stdout += chunk))
      child.stderr.on('data', (chunk) => (stderr += chunk))
      child.on('error', reject)
      child.on('close', (code) => resolve({ status: code, stdout, stderr }))
    },
  )
}

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'check-release-age-'))
}

function makeTempRepo(): string {
  const dir = makeTempDir()
  execFileSync('git', ['init', '-q'], { cwd: dir, env: ISOLATED_GIT_ENV })
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: dir,
    env: ISOLATED_GIT_ENV,
  })
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: dir, env: ISOLATED_GIT_ENV })
  return dir
}

function commitFile(repoDir: string, name: string, content: string): void {
  fs.writeFileSync(path.join(repoDir, name), content)
  execFileSync('git', ['add', name], { cwd: repoDir, env: ISOLATED_GIT_ENV })
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: repoDir, env: ISOLATED_GIT_ENV })
}

describe('check-release-age fail-closed on unreadable lockfiles', () => {
  it('whole-lockfile mode: exits 2 when the lockfile has no "packages" entries', async () => {
    const dir = makeTempDir()
    try {
      fs.writeFileSync(path.join(dir, 'lock.json'), NO_PACKAGES_LOCK)
      const result = await runScript(['--lockfile', 'lock.json'], dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('lock.json')
      expect(result.stderr).toContain('no "packages" entries')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('delta mode: exits 2 when the current lockfile has no "packages" entries', async () => {
    const dir = makeTempRepo()
    try {
      commitFile(dir, 'base.json', VALID_LOCK)
      fs.writeFileSync(path.join(dir, 'cur.json'), NO_PACKAGES_LOCK)
      const result = await runScript(['--base', 'HEAD', '--lockfile', 'cur.json'], dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('no "packages" entries')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('delta mode: exits 2 when the base lockfile has no "packages" entries', async () => {
    const dir = makeTempRepo()
    try {
      commitFile(dir, 'lock.json', NO_PACKAGES_LOCK)
      fs.writeFileSync(path.join(dir, 'lock.json'), VALID_LOCK)
      const result = await runScript(['--base', 'HEAD', '--lockfile', 'lock.json'], dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('HEAD:lock.json')
      expect(result.stderr).toContain('no "packages" entries')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('exits 2 when --registry has no URL', async () => {
    const dir = makeTempDir()
    try {
      fs.writeFileSync(path.join(dir, 'lock.json'), VALID_LOCK)
      const result = await runScript(['--lockfile', 'lock.json', '--registry'], dir)
      expect(result.status).toBe(2)
      expect(result.stderr).toContain('--registry requires a URL')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it.each(['not-a-url', 'ftp://registry.example.com/'])(
    'exits 2 when --registry is not an http(s) URL (%s)',
    async (registry) => {
      const dir = makeTempDir()
      try {
        fs.writeFileSync(path.join(dir, 'lock.json'), VALID_LOCK)
        const result = await runScript(['--lockfile', 'lock.json', '--registry', registry], dir)
        expect(result.status).toBe(2)
        expect(result.stderr).toContain('--registry must be an http(s) URL')
      } finally {
        fs.rmSync(dir, { recursive: true, force: true })
      }
    },
  )

  it('normalizes --registry before matching lockfile URLs', async () => {
    const registry = await startRegistry({ foo: { time: { '1.2.3': daysAgo(1) } } })
    const dir = makeTempDir()
    try {
      const lock = JSON.stringify({
        lockfileVersion: 3,
        packages: {
          '': { name: 'fixture', dependencies: { foo: '1.2.3' } },
          'node_modules/foo': { version: '1.2.3', resolved: `${registry.url}foo/-/foo-1.2.3.tgz` },
        },
      })
      fs.writeFileSync(path.join(dir, 'lock.json'), lock)
      // Upper-case scheme and no trailing slash: unnormalized, this matched no
      // `resolved` URL, so foo was skipped and the too-new release passed.
      const loud = registry.url.replace('http://', 'HTTP://').replace(/\/$/, '')
      const result = await runScript(['--lockfile', 'lock.json', '--registry', loud], dir)
      expect(result.status).not.toBe(0)
      expect(result.stdout + result.stderr).toContain('foo@1.2.3')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
      await registry.close()
    }
  })

  it('delta mode: unchanged lockfile still passes without a cooldown', async () => {
    const dir = makeTempRepo()
    try {
      commitFile(dir, 'lock.json', VALID_LOCK)
      const result = await runScript(['--base', 'HEAD', '--lockfile', 'lock.json'], dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('No dependency changes')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

// A lockfile whose only change vs the base is the given entry.
function lockWith(entryPath: string, meta: Record<string, string>): string {
  const lock = JSON.parse(VALID_LOCK)
  lock.packages[entryPath] = meta
  return JSON.stringify(lock)
}

describe('check-release-age first-party exemption', () => {
  async function runDelta(registryUrl: string, changed: string) {
    const dir = makeTempRepo()
    try {
      commitFile(dir, 'lock.json', VALID_LOCK)
      fs.writeFileSync(path.join(dir, 'lock.json'), changed)
      return await runScript(
        ['--registry', registryUrl, '--base', 'HEAD', '--lockfile', 'lock.json'],
        dir,
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  }

  it('exempts a registry @equationalapplications package from the cooldown once its version is verified', async () => {
    const registry = await startRegistry({
      '@equationalapplications/core-okf': { time: { '99.0.0': daysAgo(30) } },
    })
    try {
      const result = await runDelta(
        registry.url,
        lockWith('node_modules/@equationalapplications/core-okf', {
          version: '99.0.0',
          resolved: `${registry.url}@equationalapplications/core-okf/-/core-okf-99.0.0.tgz`,
        }),
      )
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('across 0 packages')
      expect(result.stdout).toContain(
        'First-party, exempt from the cooldown (@equationalapplications/): @equationalapplications/core-okf@99.0.0',
      )
    } finally {
      await registry.close()
    }
  })

  it('fails closed when an exempt first-party version was never published', async () => {
    const registry = await startRegistry({
      // The packument exists, but the locked version is missing from it.
      '@equationalapplications/core-okf': { time: { '98.0.0': daysAgo(30) } },
    })
    try {
      const result = await runDelta(
        registry.url,
        lockWith('node_modules/@equationalapplications/core-okf', {
          version: '99.0.0',
          resolved: `${registry.url}@equationalapplications/core-okf/-/core-okf-99.0.0.tgz`,
        }),
      )
      expect(result.status).toBe(1)
      expect(result.stdout).not.toContain('First-party, exempt')
      expect(result.stderr).toContain(
        '@equationalapplications/core-okf@99.0.0: no publish time in registry',
      )
    } finally {
      await registry.close()
    }
  })

  it('does not exempt an npm alias placed under the first-party scope', async () => {
    const registry = await startRegistry({
      // Published one day ago, so the alias must trip the 14-day cooldown.
      'clanker-age-gate-fixture-does-not-exist': { time: { '1.0.0': daysAgo(1) } },
    })
    try {
      const result = await runDelta(
        registry.url,
        lockWith('node_modules/@equationalapplications/aliased', {
          name: 'clanker-age-gate-fixture-does-not-exist',
          version: '1.0.0',
          resolved: `${registry.url}clanker-age-gate-fixture-does-not-exist/-/clanker-age-gate-fixture-does-not-exist-1.0.0.tgz`,
        }),
      )
      expect(result.status).toBe(1)
      expect(result.stdout).not.toContain('First-party, exempt')
      expect(result.stderr).toContain('clanker-age-gate-fixture-does-not-exist@1.0.0 published')
    } finally {
      await registry.close()
    }
  })

  it('does not exempt a first-party name served from another registry', async () => {
    const registry = await startRegistry({})
    try {
      const result = await runDelta(
        registry.url,
        lockWith('node_modules/@equationalapplications/core-okf', {
          version: '99.0.0',
          resolved:
            'https://evil.example.com/@equationalapplications/core-okf/-/core-okf-99.0.0.tgz',
        }),
      )
      expect(result.status).toBe(0)
      expect(result.stdout).not.toContain('First-party, exempt')
      expect(result.stdout).toContain('Not age-checkable, skipped')
    } finally {
      await registry.close()
    }
  })

  it('whole-lockfile mode: age-checks registry packages, exempts first-party, reports skipped entries', async () => {
    const registry = await startRegistry({
      foo: { time: { '1.2.3': daysAgo(30) } },
      '@equationalapplications/core-okf': { time: { '99.0.0': daysAgo(30) } },
    })
    const dir = makeTempDir()
    try {
      const lock = {
        lockfileVersion: 3,
        packages: {
          '': { name: 'fixture' },
          'node_modules/foo': {
            version: '1.2.3',
            resolved: `${registry.url}foo/-/foo-1.2.3.tgz`,
          },
          'node_modules/@equationalapplications/core-okf': {
            version: '99.0.0',
            resolved: `${registry.url}@equationalapplications/core-okf/-/core-okf-99.0.0.tgz`,
          },
          'node_modules/local': { version: '0.0.0', link: true },
        },
      }
      fs.writeFileSync(path.join(dir, 'lock.json'), JSON.stringify(lock))
      const result = await runScript(['--registry', registry.url, '--lockfile', 'lock.json'], dir)
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Checked 1 packages')
      expect(result.stdout).toContain(
        'First-party, exempt from the cooldown (@equationalapplications/): @equationalapplications/core-okf@99.0.0',
      )
      expect(result.stdout).toContain('Not age-checkable, skipped')
      expect(result.stdout).toContain('node_modules/local')
    } finally {
      await registry.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('treats an integrity-only change (same version, same resolved) as a delta change', async () => {
    const registry = await startRegistry({
      foo: { time: { '1.2.3': daysAgo(30) } },
    })
    const dir = makeTempRepo()
    try {
      // Same version and resolved in base and current; only integrity differs.
      const base = JSON.parse(VALID_LOCK)
      base.packages['node_modules/foo'].resolved = `${registry.url}foo/-/foo-1.2.3.tgz`
      base.packages['node_modules/foo'].integrity = 'sha512-original'
      commitFile(dir, 'lock.json', JSON.stringify(base))
      const current = JSON.parse(VALID_LOCK)
      current.packages['node_modules/foo'].resolved = `${registry.url}foo/-/foo-1.2.3.tgz`
      current.packages['node_modules/foo'].integrity = 'sha512-tampered'
      fs.writeFileSync(path.join(dir, 'lock.json'), JSON.stringify(current))
      const result = await runScript(
        ['--registry', registry.url, '--base', 'HEAD', '--lockfile', 'lock.json'],
        dir,
      )
      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Checked 1 changed package version(s) across 1 packages')
      // The root "" entry is excluded from the delta comparison, and foo is
      // the only packages entry: it changed, so nothing is inherited.
      expect(result.stdout).toContain('0 packages inherited unchanged')
    } finally {
      await registry.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
