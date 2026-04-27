const mockCallable = jest.fn()

jest.mock('firebase/app', () => ({
  getApps: () => [],
  getApp: () => ({ app: 'mock' }),
  initializeApp: () => ({ app: 'mock' }),
}))

jest.mock('firebase/app-check', () => ({
  initializeAppCheck: jest.fn(),
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
  httpsCallable: jest.fn(() => mockCallable),
}))

jest.mock('~/utilities/reportError', () => ({
  reportError: jest.fn(),
}))

describe('firebaseConfig.web voice callable export', () => {
  const env = process.env as Record<string, string | undefined>
  const originalRecaptchaKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY = 'recaptcha-site-key'
  })

  afterAll(() => {
    env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY = originalRecaptchaKey
  })

  it('exports generateVoiceReplyFn as callable function', () => {
    let loadedModule: unknown

    jest.isolateModules(() => {
      loadedModule = require('~/config/firebaseConfig.web')
    })

    const moduleExports = loadedModule as { generateVoiceReplyFn?: unknown }
    expect(typeof moduleExports.generateVoiceReplyFn).toBe('function')
  })
})