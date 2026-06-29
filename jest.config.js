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
  setupFiles: [
    '<rootDir>/jest.setup.early.js',
    '<rootDir>/jest.setup.js'
  ],
  testMatch: [
    '**/__tests__/**/*.{test,spec}.[jt]s?(x)',
    '**/?(*.)+(spec|test).[jt]s?(x)'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '<rootDir>/functions/',
    '<rootDir>/cloud-agent/dist/',
    '<rootDir>/cloud-agent/src/',
    '<rootDir>/extension/',
    '<rootDir>/shared/constants.test.ts',
    '<rootDir>/shared/dsl-schema.test.ts',
    '<rootDir>/shared/hostPolicy.test.ts',
    '<rootDir>/\\.claude/',
    '<rootDir>/\\.worktrees/',
    '<rootDir>/build/',
    '<rootDir>/dist/',
    '<rootDir>/coverage/',
    '<rootDir>/__tests__/helpers/',
    '.*\\.int\\.test\\.ts$'
  ],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|@react-native-firebase/.*|firebase/.*|@firebase/.*)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@unimodules/.*|unimodules|sentry-expo|native-base|react-native-svg)'
  ]
}
