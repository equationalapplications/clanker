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
  '.git',
  '.worktrees',
  '.brain',
  '.claude',
  '.fastembed_cache',
  'functions',
  'cloud-agent',
  'extension',
  'android',
  'ios',
  'build',
  'dist',
  'coverage',
  'temp',
])

// Suites that declare `@jest-environment jsdom` run in the 'dom' project
// (jsdom environment); everything else runs in 'native'. The docblock stays
// the single source of truth for project membership — discovered at config
// load so a new suite never has to be listed here.
//
// WHY the split: since SDK 58 (RN 0.88) the jest preset is the external
// @react-native/jest-preset, whose setup file unconditionally does
// `Object.defineProperties(global, { window: ... })`. jsdom installs `window`
// as a non-configurable global, so that define throws and the suite cannot
// even load. `patches/@react-native+jest-preset+0.88.1.patch` (patch-package)
// removes that window entry — with it applied the stock setup is jsdom-safe
// (jest-expo's own setup guards `window` with `typeof window !== 'object'`),
// so both projects share the same preset and only the environment differs.
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
    '<rootDir>/temp/',
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

// Guard: the dom project only works if the patch-package patch for the RN
// preset is applied (it removes the global.window define that breaks jsdom).
// Fail with a descriptive message instead of per-suite "Cannot redefine
// property: window" errors when postinstall was skipped or the patch drifted.
const rnPresetSetupPath = require.resolve('@react-native/jest-preset/jest/setup.js')
if (/^\s*window:\s*\{/m.test(fs.readFileSync(rnPresetSetupPath, 'utf8'))) {
  throw new Error(
    'jest.config.js: node_modules/@react-native/jest-preset/jest/setup.js still defines global.window — ' +
      'run `npx patch-package` (patches/@react-native+jest-preset+0.88.1.patch must be applied; ' +
      'it is normally applied by postinstall) or update the patch for a newer preset version.',
  )
}

module.exports = {
  projects: [
    {
      ...common,
      displayName: 'dom',
      preset: 'jest-expo',
      testEnvironment: 'jsdom',
      // Project setupFiles APPEND to the preset's (which run first), so this
      // runs after the (patched, jsdom-safe) RN + jest-expo setup.
      setupFiles: [
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
