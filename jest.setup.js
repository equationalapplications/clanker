// Mock the problematic expo-modules-core polyfill path that jest-expo tries to load
// This resolves: "Cannot find module 'expo-modules-core/src/polyfill/dangerous-internal'"
jest.mock('expo-modules-core/src/polyfill/dangerous-internal', () => ({}), {
  virtual: true,
})

// Mock expo-sqlite to prevent native module initialization errors in Jest
jest.mock('expo-sqlite', () => {
  return {
    openDatabaseAsync: jest.fn().mockResolvedValue({
      execAsync: jest.fn(),
      runAsync: jest.fn(),
      getFirstAsync: jest.fn(),
      getAllAsync: jest.fn(),
      closeAsync: jest.fn(),
    }),
    SQLiteDatabase: class MockDatabase {
      async execAsync() {}
      async runAsync() {}
      async getFirstAsync() {}
      async getAllAsync() {}
      async closeAsync() {}
    },
  }
})

// Helpers for suites that need to temporarily override Platform.OS.
// Use __setJestPlatformOS('web') in beforeEach and __resetJestPlatformOS() in afterEach.
const _rnPlatform = require('react-native').Platform
const _originalOSDescriptor =
  Object.getOwnPropertyDescriptor(_rnPlatform, 'OS') || {
    value: _rnPlatform.OS,
    configurable: true,
    writable: true,
  }

Object.defineProperty(globalThis, '__setJestPlatformOS', {
  value: (os) => {
    Object.defineProperty(_rnPlatform, 'OS', { value: os, configurable: true })
  },
  configurable: true,
})

Object.defineProperty(globalThis, '__resetJestPlatformOS', {
  value: () => {
    Object.defineProperty(_rnPlatform, 'OS', _originalOSDescriptor)
  },
  configurable: true,
})
