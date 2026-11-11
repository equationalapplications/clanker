import { execFileSync } from 'child_process'
import path from 'path'

const ROOT = path.resolve(__dirname, '..')

/** Runs patchShell(html) from the real ESM script in a node child. */
function runPatchShell(html: string): { out: string; err: string; status: number } {
  const script = `
    import(${JSON.stringify(path.join(ROOT, 'scripts/finalize-web-export.mjs'))}).then((m) => {
      try {
        process.stdout.write(m.patchShell(${JSON.stringify(html)}))
      } catch (error) {
        process.stderr.write(error.message)
        process.exit(3)
      }
    })`
  try {
    const out = execFileSync('node', ['--input-type=module', '-e', script], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    return { out, err: '', status: 0 }
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; status?: number }
    return { out: e.stdout ?? '', err: e.stderr ?? '', status: e.status ?? -1 }
  }
}

const SHELL = '<html><head><title>Clanker</title></head><body><div id="root"></div></body></html>'

describe('finalize-web-export patchShell', () => {
  it('patches the title and adds description + noindex meta', () => {
    const { out, status, err } = runPatchShell(SHELL)
    expect(status).toBe(0)
    expect(err).toBe('')
    expect(out).toContain('<title>Clanker AI</title>')
    expect(out).toContain('<meta name="description"')
    expect(out).toContain('<meta name="robots" content="noindex" />')
  })

  it('throws, not exits, when the shell has no <title>', () => {
    const { status, err } = runPatchShell('<html><head></head></html>')
    expect(status).toBe(3) // 3 = threw; process.exit(1) would report 1
    expect(err).toContain('shell has no <title> to patch')
  })

  it('throws, not exits, when the shell already carries a robots meta', () => {
    const withRobots = SHELL.replace(
      '<title>Clanker</title>',
      '<title>Clanker</title><meta name="robots" content="index" />',
    )
    const { status, err } = runPatchShell(withRobots)
    expect(status).toBe(3)
    expect(err).toContain('shell already carries a robots meta')
  })
})
