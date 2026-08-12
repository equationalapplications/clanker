// jest.config.js - Must be a .js file so we can execute code before Jest loads modules

// Note: __DEV__ is injected via NODE_OPTIONS='--require ./jest.preload.cjs'
// (see the "test" script in package.json). That runs before any Node process
// boots — including Jest worker children — which is required because
// jest.requireActual() in jest-expo's preset bypasses Jest's VM sandbox.
// Defining global.__DEV__ here would NOT propagate to worker threads.

module.exports = {
  preset: 'jest-expo',
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
  setupFiles: ['<rootDir>/jest.setup.early.js', '<rootDir>/jest.setup.js'],
  testMatch: ['**/__tests__/**/*.{test,spec}.[jt]s?(x)', '**/?(*.)+(spec|test).[jt]s?(x)'],
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
