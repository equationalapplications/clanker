const mockInitializeAppCheck = jest.fn()

jest.mock('firebase/app', () => ({
  getApps: () => [],
  getApp: () => ({ app: 'mock' }),
  initializeApp: () => ({ app: 'mock' }),
}))

jest.mock('firebase/app-check', () => ({
  initializeAppCheck: (...args: unknown[]) => mockInitializeAppCheck(...args),
  ReCaptchaEnterpriseProvider: class MockReCaptchaEnterpriseProvider {
    siteKey: string

    constructor(siteKey: string) {
      this.siteKey = siteKey
    }
  },
}))

jest.mock('firebase/auth', () => ({
  getAuth: () => ({ currentUser: null }),
  onAuthStateChanged: jest.fn(),
  signOut: jest.fn(),
}))

jest.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => jest.fn(),
}))

jest.mock('~/utilities/reportError', () => ({
  reportError: jest.fn(),
}))

describe('firebaseConfig.web App Check debug token', () => {
  const env = process.env as Record<string, string | undefined>
  const originalNodeEnv = process.env.NODE_ENV
  const originalDebugTokenEnv = process.env.EXPO_PUBLIC_WEB_APP_CHECK_DEBUG_TOKEN
  const originalRecaptchaKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY
  const originalDevFlag = (globalThis as { __DEV__?: boolean }).__DEV__

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()

    process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY = 'recaptcha-site-key'

    delete (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean })
      .FIREBASE_APPCHECK_DEBUG_TOKEN

    if (typeof window !== 'undefined') {
      delete (window as Window & { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean })
        .FIREBASE_APPCHECK_DEBUG_TOKEN
    }
  })

  afterAll(() => {
    env.NODE_ENV = originalNodeEnv
    env.EXPO_PUBLIC_WEB_APP_CHECK_DEBUG_TOKEN = originalDebugTokenEnv
    env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY = originalRecaptchaKey
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = originalDevFlag
  })

  it('does not enable debug token when __DEV__ is false', async () => {
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = false
    env.NODE_ENV = 'development'
    env.EXPO_PUBLIC_WEB_APP_CHECK_DEBUG_TOKEN = 'dev-debug-token'

    jest.isolateModules(() => {
      require('~/config/firebaseConfig.web')
    })

    expect(globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined()
    expect(window.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined()
  })

  it('enables debug token when __DEV__ is true', async () => {
    ;(globalThis as { __DEV__?: boolean }).__DEV__ = true
    env.NODE_ENV = 'development'
    env.EXPO_PUBLIC_WEB_APP_CHECK_DEBUG_TOKEN = ' auto '

    jest.isolateModules(() => {
      require('~/config/firebaseConfig.web')
    })

    expect(globalThis.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true)
    expect(window.FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true)
  })
})
