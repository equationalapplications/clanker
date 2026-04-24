// Mock the problematic expo-modules-core polyfill path that jest-expo tries to load
// This resolves: "Cannot find module 'expo-modules-core/src/polyfill/dangerous-internal'"
jest.mock('expo-modules-core/src/polyfill/dangerous-internal', () => ({}), {
  virtual: true,
})

// Mock crashlyticsService to prevent native Firebase module initialization in Jest.
// The native module is only available on device; web uses a .web.ts stub at runtime.
jest.mock('./src/services/crashlyticsService', () => ({
  initializeCrashlytics: jest.fn().mockResolvedValue(undefined),
  setCrashlyticsEnabled: jest.fn().mockResolvedValue(undefined),
  setCrashlyticsUserId: jest.fn().mockResolvedValue(undefined),
  logCrashlyticsError: jest.fn().mockResolvedValue(undefined),
}))

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

// Mock only the expo-router pieces needed for tests while preserving other runtime exports
jest.mock('expo-router', () => {
  const actualExpoRouter = jest.requireActual('expo-router')
  const mockRouter = {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => false),
    setParams: jest.fn(),
  }

  return {
    ...actualExpoRouter,
    Link: ({ children, href }) => children,
    router: actualExpoRouter.router ?? mockRouter,
    useRouter: () => mockRouter,
    useSegments: () => [],
    usePathname: () => '/',
  }
})

// Mock localStorage for web tests
const localStorageMock = (() => {
  let store = {}
  return {
    getItem: (key) =>
      Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null,
    setItem: (key, value) => {
      store[key] = value.toString()
    },
    removeItem: (key) => {
      delete store[key]
    },
    clear: () => {
      store = {}
    },
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
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
