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
jest.mock('../syncDisplayName', () => ({
  syncDisplayNameFromCredential: jest.fn(),
}))

import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth'
import { signInWithGoogle } from '../googleSignin.web'

describe('googleSignin.web', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = 'test-client'
    ;(window as any).google = {
      accounts: {
        id: {
          initialize: jest.fn(({ callback }) => {
            ;(window as any).__gisCallback = callback
          }),
          prompt: jest.fn((listener) => {
            ;(window as any).__gisCallback({ credential: 'fake-id-token' })
            listener?.({ isNotDisplayed: () => false, isSkippedMoment: () => false })
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

  it('returns error when client id missing', async () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
    expect(result.error).toContain('not configured')
  })

  it('returns error when GIS script fails to load', async () => {
    delete (window as any).google
    // Simulate script loading by not having google available
    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/unavailable/)
  })

  it('returns error when credential exchange fails', async () => {
    ;(signInWithCredential as jest.Mock).mockRejectedValueOnce(new Error('Firebase auth error'))

    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
  })

  it('handles prompt notification failure', async () => {
    ;(window as any).google.accounts.id.prompt = jest.fn((listener) => {
      listener?.({ isNotDisplayed: () => true, isSkippedMoment: () => false })
    })

    const result = await signInWithGoogle()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/unavailable/)
  })
})
