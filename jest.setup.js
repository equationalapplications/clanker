// Mock the problematic expo-modules-core polyfill path that jest-expo tries to load
// This resolves: "Cannot find module 'expo-modules-core/src/polyfill/dangerous-internal'"
jest.mock('expo-modules-core/src/polyfill/dangerous-internal', () => ({}), {
  virtual: true,
})

// Mock the native Crashlytics module directly so alias/path resolution does not
// allow @react-native-firebase/crashlytics to initialize during Jest runs.
jest.mock('@react-native-firebase/crashlytics', () => {
  const mockCrashlyticsInstance = {
    setCrashlyticsCollectionEnabled: jest.fn().mockResolvedValue(undefined),
    setUserId: jest.fn().mockResolvedValue(undefined),
    log: jest.fn(),
    recordError: jest.fn(),
  }

  const getCrashlytics = jest.fn(() => mockCrashlyticsInstance)

  return {
    __esModule: true,
    default: jest.fn(() => mockCrashlyticsInstance),
    getCrashlytics,
    setCrashlyticsCollectionEnabled: jest.fn((instance, enabled) =>
      instance.setCrashlyticsCollectionEnabled(enabled)
    ),
    setUserId: jest.fn((instance, userId) => instance.setUserId(userId)),
    log: jest.fn((instance, message) => instance.log(message)),
    recordError: jest.fn((instance, error) => instance.recordError(error)),
  }
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
//
// Platform resolved lazily in __setJestPlatformOS. The overridden instance is
// stored in _lastOverriddenPlatform so __resetJestPlatformOS always restores
// the same object, even if jest.resetModules() is called between set and reset.
const _originalOSDescriptors = new WeakMap()
let _lastOverriddenPlatform = null

function _getJestPlatform() {
  return require('react-native').Platform
}

Object.defineProperty(globalThis, '__setJestPlatformOS', {
  value: (os) => {
    const platform = _getJestPlatform()

    if (!_originalOSDescriptors.has(platform)) {
      _originalOSDescriptors.set(
        platform,
        Object.getOwnPropertyDescriptor(platform, 'OS') || {
          value: platform.OS,
          configurable: true,
          writable: true,
        }
      )
    }

    _lastOverriddenPlatform = platform
    Object.defineProperty(platform, 'OS', { value: os, configurable: true })
  },
  configurable: true,
})

Object.defineProperty(globalThis, '__resetJestPlatformOS', {
  value: () => {
    const platform = _lastOverriddenPlatform
    if (!platform) return
    const descriptor = _originalOSDescriptors.get(platform)

    if (descriptor) {
      Object.defineProperty(platform, 'OS', descriptor)
      _originalOSDescriptors.delete(platform)
    }
    _lastOverriddenPlatform = null
  },
  configurable: true,
})
