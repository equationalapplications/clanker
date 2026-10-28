// jest.config.js - Must be a .js file so we can execute code before Jest loads modules

// Note: __DEV__ is injected via NODE_OPTIONS='--require ./jest.preload.cjs'
// (see the "test" script in package.json). That runs before any Node process
// boots — including Jest worker children — which is required because
// jest.requireActual() in jest-expo's preset bypasses Jest's VM sandbox.
// Defining global.__DEV__ here would NOT propagate to worker threads.

const fs = require('node:fs')
const path = require('node:path')

const IGNORED_DIRS = new Set([
  'node_modules',
  '.worktrees',
  '.brain',
  '.claude',
  'functions',
  'cloud-agent',
  'extension',
  'android',
  'ios',
  'build',
  'dist',
  'coverage',
])

// Suites that declare `@jest-environment jsdom` must NOT run the
// @react-native/jest-preset setup file: since SDK 58 (RN 0.88) that preset is
// a separate package whose setup unconditionally does
// `Object.defineProperties(global, { window: ... })`, which throws
// "Cannot redefine property: window" under jsdom (jsdom installs `window` as a
// non-configurable global). jest-expo 57's in-package setup guarded this with
// `if (typeof window !== 'object')`; jest-expo's own setup file still guards
// and is jsdom-safe, so the dom project below uses a cloned preset with the RN
// setup stripped from setupFiles (project setupFiles only PREPEND to a preset's,
// they cannot remove it). Discovered at config load so a docblock stays the
// single source of truth.
function findJsdomSuites(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name)) continue
      findJsdomSuites(path.join(dir, entry.name), out)
      continue
    }
    if (!/\.(test|spec)\.[jt]sx?$/.test(entry.name)) continue
    const file = path.join(dir, entry.name)
    let head = ''
    try {
      const fd = fs.openSync(file, 'r')
      const buf = Buffer.alloc(512)
      const bytes = fs.readSync(fd, buf, 0, 512, 0)
      fs.closeSync(fd)
      head = buf.toString('utf8', 0, bytes)
    } catch {
      continue
    }
    if (/@jest-environment\s+jsdom/.test(head)) out.push(file)
  }
  return out
}

const jsdomSuites = findJsdomSuites(__dirname, []).map((f) =>
  f.slice(__dirname.length + 1).replace(/\\/g, '/'),
)

const common = {
  globals: {
    __DEV__: true,
  },
  // NodeNext (`cloud-agent/tsconfig.json`) requires `.js` extensions on relative
  // imports so emitted JS can resolve them at runtime. The shared/ files use
  // those extensions to satisfy both NodeNext typechecking and cloud-agent's
  // production runtime, but Jest's CJS resolver doesn't auto-strip `.js` to
  // `.ts`. Stripping them here keeps the shared source NodeNext-correct while
  // letting Jest pick up the `.ts` source files.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  // Anything excluded here must run somewhere else, or it does not run at all.
  // Where each exclusion is covered is noted inline; see .github/workflows/staging-test.yml.
  testPathIgnorePatterns: [
    '/node_modules/',
    // functions/ and cloud-agent/ use node:test, not Jest. Both are run by
    // staging-test.yml as separate `npm test` steps.
    '<rootDir>/functions/',
    '<rootDir>/cloud-agent/dist/',
    '<rootDir>/cloud-agent/src/',
    '<rootDir>/extension/',
    // Excluded from cloud-agent's build too, so these run in staging-test.yml
    // via `node --import tsx/esm --test`.
    '<rootDir>/shared/constants.test.ts',
    '<rootDir>/shared/dsl-schema.test.ts',
    '<rootDir>/shared/hostPolicy.test.ts',
    '<rootDir>/\\.claude/',
    '<rootDir>/\\.worktrees/',
    '<rootDir>/build/',
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
    '<rootDir>/__tests__/helpers/',
    // Live edge-agent evals. MANUAL ONLY and intentionally not in CI — they
    // cost money per run and need live credentials. Run with `npm run
    // edge-evals`, whose jest.evals.config.js testRegex matches exactly this
    // pattern. Nothing else executes these files.
    '.*\\.int\\.test\\.ts$',
  ],
  modulePathIgnorePatterns: ['<rootDir>/\\.worktrees/'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-firebase/.*|firebase/.*|@firebase/.*)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)',
  ],
}

const TEST_MATCH = ['**/__tests__/**/*.{test,spec}.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)']

// The dom project needs the full RN preset setup (jest-expo's own setup depends
// on the native-bridge mocks it installs), but the stock setup file redefines
// global.window, which throws under jsdom. Generate a patched copy with ONLY
// the `window` entry removed — done at config load from the installed preset
// source, so it tracks whatever @react-native/jest-preset version is installed.
// Revisit/remove when the upstream guard lands.
// Relative imports inside the setup file (`./mock`) must resolve against the
// preset's own directory, so the patched copy is written THERE, not into the
// repo root. (node_modules is writable in this workspace; on a pristine CI
// install the write re-runs at config load.)
const rnSetupPath = require.resolve('@react-native/jest-preset/jest/setup.js')
const rnSetupSource = fs.readFileSync(rnSetupPath, 'utf8')
const patchedRnSetup = rnSetupSource.replace(
  /\n\s*window:\s*\{[^{}]*\},/,
  '\n  // window entry removed for jsdom compatibility — see jest.config.js',
)
if (patchedRnSetup === rnSetupSource) {
  throw new Error(
    'jest.config.js: could not patch @react-native/jest-preset setup.js (window entry not found); ' +
      'the SDK 58 jsdom workaround needs updating.',
  )
}
const patchedSetupPath = path.join(path.dirname(rnSetupPath), 'setup.dom-patched.js')
fs.writeFileSync(patchedSetupPath, patchedRnSetup)

// Clone the jest-expo preset config for the dom project and swap the RN setup
// file for the patched copy. Everything else — transforms,
// transformIgnorePatterns, module mappers — must stay identical to native.
const expoPresetConfig = require('jest-expo/jest-preset')
const domSetupFiles = expoPresetConfig.setupFiles.map((f) =>
  /@react-native[\\/]jest-preset[\\/]jest[\\/]setup\.js$/.test(f) ? patchedSetupPath : f,
)

module.exports = {
  projects: [
    {
      ...common,
      ...expoPresetConfig,
      passWithNoTests: undefined,
      displayName: 'dom',
      testEnvironment: 'jsdom',
      setupFiles: [
        ...domSetupFiles,
        '<rootDir>/jest.setup.early.js',
        '<rootDir>/jest.setup.js',
        '<rootDir>/jest.setup.dom.js',
      ],
      testMatch: jsdomSuites.map((f) => `<rootDir>/${f}`),
    },
    {
      ...common,
      displayName: 'native',
      preset: 'jest-expo',
      setupFiles: ['<rootDir>/jest.setup.early.js', '<rootDir>/jest.setup.js'],
      testMatch: TEST_MATCH,
      testPathIgnorePatterns: [
        ...common.testPathIgnorePatterns,
        // jsdom suites run in the dom project above.
        ...jsdomSuites.map((f) => `<rootDir>/${f}`),
      ],
    },
  ],
}
