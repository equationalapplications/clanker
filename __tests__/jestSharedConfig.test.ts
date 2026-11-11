import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const shared = require('../jest.shared.config') as {
  isJsdomSource: (source: string) => boolean
  findJsdomSuites: (rootDir: string) => string[]
  escapeRegExp: (str: string) => string
  jsdomSuitePattern: (rootDir: string, relPath: string) => string
  domTestRegex: (rootDir: string, suites: string[]) => string[]
}

const PRAGMA = '/** @jest-environment jsdom */\ntest("t", () => {})\n'

describe('jest.shared.config', () => {
  describe('isJsdomSource', () => {
    it('finds a pragma beyond the first 1 KB of a leading docblock', () => {
      const src = '/**\n * ' + 'x'.repeat(1024) + '\n * @jest-environment jsdom\n */\ntest()'
      expect(shared.isJsdomSource(src)).toBe(true)
    })

    it('accepts the long environment name Jest resolves to jsdom', () => {
      expect(shared.isJsdomSource('/** @jest-environment jest-environment-jsdom */\n')).toBe(true)
    })

    it('ignores a pragma outside the first docblock', () => {
      expect(shared.isJsdomSource('/** header */\n/** @jest-environment jsdom */\n')).toBe(false)
    })

    it('treats an explicit node docblock as native despite later jsdom mention', () => {
      const src = '/**\n * @jest-environment node\n */\n// @jest-environment jsdom\n'
      expect(shared.isJsdomSource(src)).toBe(false)
    })
  })

  describe('findJsdomSuites', () => {
    it('applies the depth rule and handles special path characters', () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jest-shared-'))
      try {
        const write = (rel: string, content: string) => {
          const file = path.join(root, rel)
          fs.mkdirSync(path.dirname(file), { recursive: true })
          fs.writeFileSync(file, content)
        }
        write('src/x/build/__tests__/a.test.ts', PRAGMA)
        write('build/b.test.ts', PRAGMA)
        write('src/node_modules/c.test.ts', PRAGMA)
        write('src/y/.worktrees/d.test.ts', PRAGMA)
        write('app/(tabs)/[id]/__tests__/e.test.tsx', PRAGMA)
        write('src/probe-hy/f.test.ts', PRAGMA)
        write('src/g.test.ts', 'test("g", () => {})\n')
        expect(shared.findJsdomSuites(root)).toEqual([
          'app/(tabs)/[id]/__tests__/e.test.tsx',
          'src/probe-hy/f.test.ts',
          'src/x/build/__tests__/a.test.ts',
        ])
      } finally {
        fs.rmSync(root, { recursive: true, force: true })
      }
    })
  })

  describe('jsdomSuitePattern', () => {
    it('escapes the root path and anchors the match', () => {
      const rel = 'app/(tabs)/[id]/__tests__/e.test.tsx'
      const p = shared.jsdomSuitePattern('/r/a.b(c)+', rel)
      const same = '/r/a.b(c)+/' + rel
      expect(new RegExp(p).test(same)).toBe(true)
      expect(new RegExp(p).test('/r/aXb(c)+/' + rel)).toBe(false)
      expect(new RegExp(p).test(same + '.snap')).toBe(false)
      expect(() => new RegExp(p, 'u')).not.toThrow()
    })
  })

  describe('domTestRegex', () => {
    it('never matches when no suite declares jsdom', () => {
      const patterns = shared.domTestRegex('/r', [])
      expect(patterns).toHaveLength(1)
      expect(new RegExp(patterns[0]).test('/r/src/a.test.ts')).toBe(false)
    })

    it('anchors one pattern per suite', () => {
      expect(shared.domTestRegex('/r', ['a.test.ts', 'b.test.ts'])).toEqual([
        shared.jsdomSuitePattern('/r', 'a.test.ts'),
        shared.jsdomSuitePattern('/r', 'b.test.ts'),
      ])
    })
  })

  // Wiring guard: the real jest.config.js must put every discovered jsdom suite in
  // the dom project and keep it out of native, and leave ordinary suites to native.
  describe('jest.config.js projects', () => {
    type Project = {
      displayName: string
      testRegex?: string[]
      testPathIgnorePatterns: string[]
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { projects } = require('../jest.config') as { projects: Project[] }
    const root = fs.realpathSync.native(path.resolve(__dirname, '..'))
    const dom = projects.find((p) => p.displayName === 'dom')!
    const native = projects.find((p) => p.displayName === 'native')!
    const compile = (patterns: string[]) =>
      patterns.map((p) => new RegExp(p.split('<rootDir>').join(root)))
    const domRegex = compile(dom.testRegex ?? [])
    const nativeIgnore = compile(native.testPathIgnorePatterns)
    const jsdomSuites = shared.findJsdomSuites(root).map((f) => path.join(root, f))

    it('discovers jsdom suites in this repo', () => {
      expect(jsdomSuites.length).toBeGreaterThan(0)
    })

    it('runs each jsdom suite in dom only', () => {
      for (const file of jsdomSuites) {
        expect(domRegex.some((r) => r.test(file))).toBe(true)
        expect(nativeIgnore.some((r) => r.test(file))).toBe(true)
      }
    })

    it('leaves a non-jsdom suite to native only', () => {
      const file = fs.realpathSync.native(__filename)
      expect(domRegex.some((r) => r.test(file))).toBe(false)
      expect(nativeIgnore.some((r) => r.test(file))).toBe(false)
    })
  })
})
