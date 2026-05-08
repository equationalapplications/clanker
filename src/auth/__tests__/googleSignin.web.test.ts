/** @jest-environment jsdom */

import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { resetGoogleSignInWebForTests, signInWithGoogle } from '../googleSignin.web'
import { syncDisplayNameFromCredential } from '../syncDisplayName.web'

jest.mock('firebase/auth', () => {
  const signInWithCredential = jest.fn().mockResolvedValue({
    user: { displayName: null, providerData: [], updateProfile: jest.fn() },
  })
  const credential = jest.fn((idToken: string) => ({ idToken }))

  class GoogleAuthProvider {
    static credential = credential
  }

  return {
    GoogleAuthProvider,
    getAuth: jest.fn(() => ({})),
    signInWithCredential,
    signInWithPopup: jest.fn(),
  }
})
jest.mock('~/config/firebaseConfig.web', () => ({ firebaseApp: {} }))
jest.mock('../syncDisplayName.web', () => ({
  syncDisplayNameFromCredential: jest.fn(),
}))

const originalGoogleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID

describe('googleSignin.web', () => {
  afterEach(() => {
    if (originalGoogleWebClientId === undefined) {
      delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
    } else {
      process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = originalGoogleWebClientId
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    resetGoogleSignInWebForTests()
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-client'
    ;(window as any).google = {
      accounts: {
        id: {
          initialize: jest.fn(({ callback }) => {
            ;(window as any).__gisCallback = callback
          }),
          prompt: jest.fn((listener) => {
            void (window as any).__gisCallback({ credential: 'fake-id-token' })
            listener?.({
              isNotDisplayed: () => false,
              isSkippedMoment: () => false,
              isDismissedMoment: () => false,
            })
          }),
          renderButton: jest.fn(),
          disableAutoSelect: jest.fn(),
        },
      },
    }
  })

  it('signInWithGoogle exchanges GIS ID token via signInWithCredential', async () => {
    const result = await signInWithGoogle()
    expect(result.success).toBe(true)
    expect(GoogleAuthProvider.credential).toHaveBeenCalledWith('fake-id-token', null)
    expect(signInWithCredential).toHaveBeenCalled()
  })

  it('still succeeds when display name sync fails after credential exchange', async () => {
    jest.mocked(syncDisplayNameFromCredential).mockRejectedValueOnce(new Error('sync failed'))
    const result = await signInWithGoogle()
    expect(result.success).toBe(true)
  })

  it('returns error when client id missing', async () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
    expect(result.error).toContain('not configured')
  })

  it('returns error when GIS script fails to load', async () => {
    delete (window as any).google
    const orig = document.createElement.bind(document)
    jest.spyOn(document, 'createElement').mockImplementation((tagName: any, options?: any) => {
      const el = orig(tagName, options)
      if (String(tagName).toLowerCase() === 'script') {
        queueMicrotask(() => (el as HTMLScriptElement).onerror?.(new Event('error')))
      }
      return el
    })
    try {
      const result = await signInWithGoogle()
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/unavailable|Failed to load/)
    } finally {
      jest.restoreAllMocks()
    }
  })

  it('returns error when credential exchange fails', async () => {
    ;(signInWithCredential as jest.Mock).mockRejectedValueOnce(new Error('Firebase auth error'))

    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
  })

  it('handles prompt notification failure', async () => {
    ;(window as any).google.accounts.id.prompt = jest.fn((listener) => {
      listener?.({
        isNotDisplayed: () => true,
        isSkippedMoment: () => false,
        isDismissedMoment: () => false,
      })
    })

    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/unavailable/)
  })

  it('resolves when One Tap is dismissed', async () => {
    ;(window as any).google.accounts.id.prompt = jest.fn((listener) => {
      listener?.({
        isNotDisplayed: () => false,
        isSkippedMoment: () => false,
        isDismissedMoment: () => true,
        getDismissedReason: () => 'cancel_called',
      })
    })

    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/cancelled/)
  })

  it('does not treat credential_returned dismissal as user cancel during token exchange', async () => {
    ;(window as any).google.accounts.id.prompt = jest.fn((listener) => {
      void (window as any).__gisCallback({ credential: 'fake-id-token' })
      listener?.({
        isNotDisplayed: () => false,
        isSkippedMoment: () => false,
        isDismissedMoment: () => true,
        getDismissedReason: () => 'credential_returned',
      })
    })

    const result = await signInWithGoogle()
    expect(result.success).toBe(true)
  })
})
