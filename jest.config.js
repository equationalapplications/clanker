// jest.config.js - Must be a .js file so we can execute code before Jest loads modules

// Note: __DEV__ is injected via NODE_OPTIONS='--require ./jest.preload.cjs'
// (see the "test" script in package.json). That runs before any Node process
// boots — including Jest worker children — which is required because
// jest.requireActual() in jest-expo's preset bypasses Jest's VM sandbox.
// Defining global.__DEV__ here would NOT propagate to worker threads.

const fs = require('node:fs')

const {
  TRANSFORM_IGNORE_PATTERNS,
  findJsdomSuites,
  jsdomSuitePattern,
  domTestRegex,
} = require('./jest.shared.config')

// Jest realpaths its rootDir before matching; use the same form here so the
// absolute patterns below match (e.g. Windows 8.3 short names, symlinked dirs).
const ROOT = fs.realpathSync.native(__dirname)
const jsdomSuites = findJsdomSuites(ROOT)

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
  transformIgnorePatterns: TRANSFORM_IGNORE_PATTERNS,
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
      testRegex: domTestRegex(ROOT, jsdomSuites),
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
        ...jsdomSuites.map((f) => jsdomSuitePattern(ROOT, f)),
      ],
    },
  ],
}
