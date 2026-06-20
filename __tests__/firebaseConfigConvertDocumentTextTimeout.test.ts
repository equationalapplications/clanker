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

jest.mock('~/utilities/reportError', () => ({
  reportError: jest.fn(),
}))

describe('convertDocumentText callable timeout', () => {
  const env = process.env as Record<string, string | undefined>
  const originalRecaptchaKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY

  beforeEach(() => {
    process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY = 'recaptcha-site-key'
  })

  afterAll(() => {
    env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY = originalRecaptchaKey
  })

  it('passes a 545s timeout on web', () => {
    let capturedHttpsCallable: jest.Mock | undefined

    jest.isolateModules(() => {
      jest.doMock('firebase/functions', () => ({
        getFunctions: () => ({}),
        httpsCallable: jest.fn(() => jest.fn()),
      }))
      const functionsModule = require('firebase/functions')
      capturedHttpsCallable = functionsModule.httpsCallable
      require('~/config/firebaseConfig.web')
    })

    expect(capturedHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'convertDocumentText',
      { timeout: 545_000 },
    )
  })

  it('passes a 545s timeout on native', () => {
    let capturedHttpsCallable: jest.Mock | undefined

    jest.isolateModules(() => {
      jest.doMock('@react-native-firebase/functions', () => ({
        __esModule: true,
        getFunctions: jest.fn(() => ({})),
        httpsCallable: jest.fn(() => jest.fn()),
      }))
      const functionsModule = require('@react-native-firebase/functions')
      capturedHttpsCallable = functionsModule.httpsCallable
      require('~/config/firebaseConfig')
    })

    expect(capturedHttpsCallable).toHaveBeenCalledWith(
      expect.anything(),
      'convertDocumentText',
      { timeout: 545_000 },
    )
  })
})
